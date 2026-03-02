import { Hono, type Context } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Bus } from "../../bus"
import { Session } from "../../session"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { AsyncQueue } from "../../util/queue"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Tui } from "@/tui"
import { SessionStatus } from "@/session/status"
import { SessionPrompt } from "@/session/prompt"

const TuiRequest = z.object({
  path: z.string(),
  body: z.any(),
})

type TuiRequest = z.infer<typeof TuiRequest>

const request = new AsyncQueue<TuiRequest>()
const response = new AsyncQueue<any>()
const runtime = {
  handle: null as Tui.Handle | null,
  mode: "none" as "none" | "spawned" | "connected",
  sessionID: null as string | null,
}

export async function callTui(ctx: Context) {
  const body = await ctx.req.json()
  request.push({
    path: ctx.req.path,
    body,
  })
  return response.next()
}

const TuiControlRoutes = new Hono()
  .get(
    "/next",
    describeRoute({
      summary: "Get next TUI request",
      description: "Retrieve the next TUI (Terminal User Interface) request from the queue for processing.",
      operationId: "tui.control.next",
      responses: {
        200: {
          description: "Next TUI request",
          content: {
            "application/json": {
              schema: resolver(TuiRequest),
            },
          },
        },
      },
    }),
    async (c) => {
      const req = await request.next()
      return c.json(req)
    },
  )
  .post(
    "/response",
    describeRoute({
      summary: "Submit TUI response",
      description: "Submit a response to the TUI request queue to complete a pending request.",
      operationId: "tui.control.response",
      responses: {
        200: {
          description: "Response submitted successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("json", z.any()),
    async (c) => {
      const body = c.req.valid("json")
      response.push(body)
      return c.json(true)
    },
  )

export const TuiRoutes = lazy(() =>
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
          })
          .default({}),
      ),
      async (c) => {
        const body = c.req.valid("json")
        if (runtime.handle && !runtime.handle.closed) {
          await runtime.handle.close().catch(() => {})
        }

        if (body.mode === "connect") {
          if (!body.url) {
            throw new Error("url is required when mode=connect")
          }
          runtime.handle = Tui.connect(body.url)
          runtime.mode = "connected"
          runtime.sessionID = body.sessionID ?? null
          return c.json({ mode: runtime.mode, url: runtime.handle.url })
        }

        runtime.handle = await Tui.spawn({
          directory: body.directory,
          sessionID: body.sessionID,
          model: body.model,
          agent: body.agent,
          prompt: body.prompt,
          continue: body.continue,
          fork: body.fork,
          port: body.port,
          hostname: body.hostname,
          bin: body.bin,
        })
        runtime.mode = "spawned"
        runtime.sessionID = body.sessionID ?? null
        return c.json({ mode: runtime.mode, url: runtime.handle.url })
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
        return c.json({
          running: !!runtime.handle && !runtime.handle.closed,
          mode: runtime.mode,
          url: runtime.handle?.url ?? null,
          sessionID: runtime.sessionID,
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
        if (runtime.handle && !runtime.handle.closed) {
          await runtime.handle.close().catch(() => {})
        }
        runtime.handle = null
        runtime.mode = "none"
        runtime.sessionID = null
        return c.json(true)
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

        const sessionID = body.sessionID ?? runtime.sessionID
        if (!sessionID) {
          throw new Error("sessionID is required. Pass it in /tui/runtime/start or /tui/runtime/submit-task.")
        }
        runtime.sessionID = sessionID

        const run = () =>
          SessionPrompt.prompt({
            sessionID,
            agent: body.agent,
            parts: [
              {
                type: "text",
                text: body.text,
              },
            ],
          })

        const wait = body.wait ?? true
        if (!wait) {
          void run().catch(() => {})
          return c.json({
            accepted: true,
            sessionID,
            waited: false,
            completed: false,
            message: null,
          })
        }

        const start = Date.now()
        const timeoutMs = body.timeoutMs ?? 5 * 60 * 1000

        const result = await Promise.race([
          run().then((message) => ({ kind: "done" as const, message })),
          new Promise<{ kind: "timeout" as const }>((resolve) =>
            setTimeout(() => resolve({ kind: "timeout" }), timeoutMs),
          ),
        ])

        if (result.kind === "done") {
          return c.json({
            accepted: true,
            sessionID,
            waited: true,
            completed: true,
            message: result.message,
          })
        }

        const status = SessionStatus.get(sessionID)
        const msgs = await Session.messages({ sessionID, limit: 50 })
        const latest = msgs
          .filter((m) => m.info.role === "assistant" && m.info.time.created >= start)
          .at(-1) ?? null
        return c.json({
          accepted: true,
          sessionID,
          waited: true,
          completed: status.type === "idle" && !!latest,
          message: latest,
        })
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
        if (!runtime.handle || runtime.handle.closed) {
          throw new Error("TUI runtime is not running. Call /tui/runtime/start first.")
        }
        if (!body.path.startsWith("/tui/")) {
          throw new Error("proxy path must start with /tui/")
        }

        const res = await fetch(`${runtime.handle.url}${body.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body.body ?? {}),
        })
        const text = await res.text()
        if (!res.ok) {
          throw new Error(`TUI proxy failed: ${res.status} ${body.path} ${text}`)
        }

        return c.body(text, 200, {
          "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        })
      },
    )
    .post(
      "/append-prompt",
      describeRoute({
        summary: "Append TUI prompt",
        description: "Append prompt to the TUI",
        operationId: "tui.appendPrompt",
        responses: {
          200: {
            description: "Prompt processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", TuiEvent.PromptAppend.properties),
      async (c) => {
        await Bus.publish(TuiEvent.PromptAppend, c.req.valid("json"))
        return c.json(true)
      },
    )
    .post(
      "/open-help",
      describeRoute({
        summary: "Open help dialog",
        description: "Open the help dialog in the TUI to display user assistance information.",
        operationId: "tui.openHelp",
        responses: {
          200: {
            description: "Help dialog opened successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "help.show",
        })
        return c.json(true)
      },
    )
    .post(
      "/open-sessions",
      describeRoute({
        summary: "Open sessions dialog",
        description: "Open the session dialog",
        operationId: "tui.openSessions",
        responses: {
          200: {
            description: "Session dialog opened successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "session.list",
        })
        return c.json(true)
      },
    )
    .post(
      "/open-themes",
      describeRoute({
        summary: "Open themes dialog",
        description: "Open the theme dialog",
        operationId: "tui.openThemes",
        responses: {
          200: {
            description: "Theme dialog opened successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "session.list",
        })
        return c.json(true)
      },
    )
    .post(
      "/open-models",
      describeRoute({
        summary: "Open models dialog",
        description: "Open the model dialog",
        operationId: "tui.openModels",
        responses: {
          200: {
            description: "Model dialog opened successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "model.list",
        })
        return c.json(true)
      },
    )
    .post(
      "/submit-prompt",
      describeRoute({
        summary: "Submit TUI prompt",
        description: "Submit the prompt",
        operationId: "tui.submitPrompt",
        responses: {
          200: {
            description: "Prompt submitted successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "prompt.submit",
        })
        return c.json(true)
      },
    )
    .post(
      "/clear-prompt",
      describeRoute({
        summary: "Clear TUI prompt",
        description: "Clear the prompt",
        operationId: "tui.clearPrompt",
        responses: {
          200: {
            description: "Prompt cleared successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, {
          command: "prompt.clear",
        })
        return c.json(true)
      },
    )
    .post(
      "/execute-command",
      describeRoute({
        summary: "Execute TUI command",
        description: "Execute a TUI command (e.g. agent_cycle)",
        operationId: "tui.executeCommand",
        responses: {
          200: {
            description: "Command executed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ command: z.string() })),
      async (c) => {
        const command = c.req.valid("json").command
        await Bus.publish(TuiEvent.CommandExecute, {
          // @ts-expect-error
          command: {
            session_new: "session.new",
            session_share: "session.share",
            session_interrupt: "session.interrupt",
            session_compact: "session.compact",
            messages_page_up: "session.page.up",
            messages_page_down: "session.page.down",
            messages_line_up: "session.line.up",
            messages_line_down: "session.line.down",
            messages_half_page_up: "session.half.page.up",
            messages_half_page_down: "session.half.page.down",
            messages_first: "session.first",
            messages_last: "session.last",
            agent_cycle: "agent.cycle",
          }[command],
        })
        return c.json(true)
      },
    )
    .post(
      "/show-toast",
      describeRoute({
        summary: "Show TUI toast",
        description: "Show a toast notification in the TUI",
        operationId: "tui.showToast",
        responses: {
          200: {
            description: "Toast notification shown successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", TuiEvent.ToastShow.properties),
      async (c) => {
        await Bus.publish(TuiEvent.ToastShow, c.req.valid("json"))
        return c.json(true)
      },
    )
    .post(
      "/publish",
      describeRoute({
        summary: "Publish TUI event",
        description: "Publish a TUI event",
        operationId: "tui.publish",
        responses: {
          200: {
            description: "Event published successfully",
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
        z.union(
          Object.values(TuiEvent).map((def) => {
            return z
              .object({
                type: z.literal(def.type),
                properties: def.properties,
              })
              .meta({
                ref: "Event" + "." + def.type,
              })
          }),
        ),
      ),
      async (c) => {
        const evt = c.req.valid("json")
        await Bus.publish(Object.values(TuiEvent).find((def) => def.type === evt.type)!, evt.properties)
        return c.json(true)
      },
    )
    .post(
      "/select-session",
      describeRoute({
        summary: "Select session",
        description: "Navigate the TUI to display the specified session.",
        operationId: "tui.selectSession",
        responses: {
          200: {
            description: "Session selected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", TuiEvent.SessionSelect.properties),
      async (c) => {
        const { sessionID } = c.req.valid("json")
        await Session.get(sessionID)
        await Bus.publish(TuiEvent.SessionSelect, { sessionID })
        return c.json(true)
      },
    )
    .route("/control", TuiControlRoutes),
)
