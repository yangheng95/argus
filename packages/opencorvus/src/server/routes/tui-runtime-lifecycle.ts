import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { TuiRuntime } from "@/tui/runtime"

export const TuiRuntimeLifecycleRoutes = lazy(() =>
  new Hono()
    .post(
      "/runtime/start",
      describeRoute({
        summary: "Start or connect TUI runtime",
        description: "Start a managed TUI subprocess or connect to an existing TUI server for internal API control.",
        operationId: "tui.runtime.start",
        responses: {
          200: {
            description: "TUI runtime ready",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    mode: z.enum(["spawned", "connected"]),
                    url: z.string(),
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
          mode: z.enum(["spawn", "connect"]).default("spawn"),
          url: z.string().optional(),
          directory: z.string().optional(),
          sessionID: z.string().optional(),
          model: z.string().optional(),
          agent: z.string().optional(),
          prompt: z.string().optional(),
          continue: z.boolean().optional(),
          fork: z.boolean().optional(),
          port: z.number().int().optional(),
          hostname: z.string().optional(),
          bin: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await TuiRuntime.start(body))
      },
    )
    .get(
      "/runtime/status",
      describeRoute({
        summary: "Get TUI runtime status",
        description: "Get status of the managed TUI runtime used by internal API control.",
        operationId: "tui.runtime.status",
        responses: {
          200: {
            description: "TUI runtime status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    running: z.boolean(),
                    mode: z.enum(["none", "spawned", "connected"]),
                    url: z.string().nullable(),
                    sessionID: z.string().nullable(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(TuiRuntime.status())
      },
    )
    .post(
      "/runtime/stop",
      describeRoute({
        summary: "Stop TUI runtime",
        description: "Stop the managed TUI runtime process if it was started by internal API.",
        operationId: "tui.runtime.stop",
        responses: {
          200: {
            description: "TUI runtime stopped",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await TuiRuntime.stop())
      },
    ),
)
