import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { SessionStatus } from "@/session/status"
import { TuiRuntime } from "@/tui/runtime"
import { TuiCommand } from "@/tui/command"

export const TuiRuntimeRoutes = lazy(() =>
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
        z
          .object({
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
    .get(
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
    )
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
