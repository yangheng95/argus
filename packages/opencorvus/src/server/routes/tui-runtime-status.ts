import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { SessionStatus } from "@/session"
import { TuiRuntime } from "@/tui/runtime"
import { TuiCommand } from "@/tui/command"

export const TuiRuntimeStatusRoutes = lazy(() =>
  new Hono().get(
    "/status",
    describeRoute({
      summary: "Get TUI status",
      description: "Get TUI runtime state, session execution status, and command aliases.",
      operationId: "tui.status",
      responses: {
        200: {
          description: "TUI status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  runtime: z.object({
                    running: z.boolean(),
                    mode: z.enum(["none", "spawned", "connected"]),
                    url: z.string().nullable(),
                    sessionID: z.string().nullable(),
                  }),
                  sessions: z.record(z.string(), SessionStatus.Info),
                  commands: z.object({
                    aliases: z.array(z.string()),
                  }),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({
        runtime: TuiRuntime.status(),
        sessions: SessionStatus.list(),
        commands: {
          aliases: TuiCommand.aliases,
        },
      })
    },
  ),
)
