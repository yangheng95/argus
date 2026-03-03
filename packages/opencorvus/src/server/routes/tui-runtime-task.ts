import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { TuiRuntime } from "@/tui/runtime"

export const TuiRuntimeTaskRoutes = lazy(() =>
  new Hono()
    .post(
      "/runtime/submit-task",
      describeRoute({
        summary: "Submit task to managed TUI and optionally wait",
        description:
          "Submit a task through Session API and optionally wait until completion. TUI runtime is only for UI lifecycle, not task execution truth.",
        operationId: "tui.runtime.submitTask",
        responses: {
          200: {
            description: "Task submitted",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    accepted: z.literal(true),
                    sessionID: z.string(),
                    waited: z.boolean(),
                    completed: z.boolean(),
                    message: z.any().nullable(),
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
          text: z.string().min(1),
          sessionID: z.string().optional(),
          agent: z.string().optional(),
          wait: z.boolean().default(true).optional(),
          timeoutMs: z.number().int().min(1000).max(30 * 60 * 1000).default(5 * 60 * 1000).optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await TuiRuntime.submitTask(body))
      },
    )
    .post(
      "/runtime/proxy",
      describeRoute({
        summary: "Proxy control to managed TUI",
        description: "Proxy a POST request to the managed TUI instance (e.g. /tui/append-prompt, /tui/submit-prompt).",
        operationId: "tui.runtime.proxy",
        responses: {
          200: {
            description: "Proxy result",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          body: z.any().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await TuiRuntime.proxy(body))
      },
    ),
)
