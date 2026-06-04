import { Hono, type Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Bus } from "../../bus"
import { Session, SessionStatus } from "../../session"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { TuiCommand } from "@/tui/command"
import { TuiHost } from "@/tui/host"
import { TuiRuntime } from "@/tui/runtime"
import { Flag } from "../../flag/flag"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Instance } from "@/project/instance"

// ============================================================================
// /control queue plumbing — shared state for control-plane proxy routes
// ============================================================================

const TuiControlRequest = z.object({
  id: z.string(),
  path: z.string(),
  body: z.unknown(),
})
const TuiControlResponse = z
  .object({
    id: z.string(),
    body: z.unknown().optional(),
    error: z.string().min(1).optional(),
  })
  .refine((value) => (value.body === undefined) !== (value.error === undefined), {
    message: "exactly one of body or error is required",
  })

type TuiControlRequest = z.infer<typeof TuiControlRequest>

const TuiHostInfo = z.object({
  id: z.string().nullable(),
  running: z.boolean(),
  status: z.enum(["idle", "running", "exited"]),
  cols: z.number().int().nullable(),
  rows: z.number().int().nullable(),
  url: z.string().nullable(),
  directory: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  createdAt: z.number().int().nullable(),
  updatedAt: z.number().int().nullable(),
})

const TuiHostSnapshot = TuiHostInfo.extend({
  buffer: z.string(),
})

const TuiHostOutput = TuiHostInfo.extend({
  data: z.string(),
  cursor: z.number().int(),
  from: z.number().int(),
  truncated: z.boolean(),
})

const TuiHostStart = z.object({
  sessionID: z.string().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  prompt: z.string().optional(),
  continue: z.boolean().optional(),
  fork: z.boolean().optional(),
  port: z.number().int().optional(),
  hostname: z.string().optional(),
  bin: z.string().optional(),
  cols: z.number().int().min(1).max(500).default(100).optional(),
  rows: z.number().int().min(1).max(200).default(30).optional(),
})

function mapTuiHostRouteError(error: unknown): never {
  if (error instanceof Error && error.message === "TUI host is not running") {
    throw new HTTPException(400, { message: error.message })
  }
  throw error
}

const requestQueue: TuiControlRequest[] = []
const requestWaiters: Array<(item: TuiControlRequest) => void> = []
const NEXT_ABORTED = "tui control next aborted"

function pushRequest(item: TuiControlRequest) {
  const next = requestWaiters.shift()
  if (next) {
    next(item)
    return
  }
  requestQueue.push(item)
}

function dropRequest(id: string) {
  const index = requestQueue.findIndex((item) => item.id === id)
  if (index >= 0) {
    requestQueue.splice(index, 1)
  }
}

function popRequest(signal?: AbortSignal): Promise<TuiControlRequest> {
  const next = requestQueue.shift()
  if (next) return Promise.resolve(next)
  if (signal?.aborted) return Promise.reject(new Error(NEXT_ABORTED))
  return new Promise<TuiControlRequest>((resolve, reject) => {
    const item = (value: TuiControlRequest) => {
      signal?.removeEventListener("abort", onAbort)
      resolve(value)
    }
    const onAbort = () => {
      const index = requestWaiters.indexOf(item)
      if (index >= 0) requestWaiters.splice(index, 1)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error(NEXT_ABORTED))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    requestWaiters.push(item)
  })
}

const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }
>()

async function nextRequest(signal?: AbortSignal): Promise<TuiControlRequest> {
  while (true) {
    const item = await popRequest(signal)
    if (signal?.aborted) throw new Error(NEXT_ABORTED)
    if (pending.has(item.id)) return item
  }
}

export async function callTui(ctx: Context) {
  const body = await ctx.req.json()
  const id = crypto.randomUUID()
  pushRequest({
    id,
    path: ctx.req.path,
    body,
  })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      dropRequest(id)
      reject(new Error(`tui control response timeout for request ${id}`))
    }, Flag.OPENCORVUS_TUI_CONTROL_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timeout })
  })
}

// ============================================================================
// Routes
// ============================================================================

export const TuiRoutes = lazy(() =>
  new Hono()
    // === host: embedded right-sidebar terminal ===
    .post(
      "/host/start",
      describeRoute({
        summary: "Start embedded TUI host",
        description:
          "Start the project-bound TUI process inside a Pseudo Terminal (PTY) for right-sidebar terminal rendering.",
        operationId: "tui.host.start",
        responses: {
          200: {
            description: "Embedded TUI host started",
            content: { "application/json": { schema: resolver(TuiHostInfo) } },
          },
          ...errors(400),
        },
      }),
      validator("json", TuiHostStart),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await TuiHost.start({ ...body, directory: Instance.directory }))
      },
    )
    .get(
      "/host/status",
      describeRoute({
        summary: "Get embedded TUI host status",
        description: "Get the project-bound right-sidebar TUI host status.",
        operationId: "tui.host.status",
        responses: {
          200: {
            description: "Embedded TUI host status",
            content: { "application/json": { schema: resolver(TuiHostInfo) } },
          },
        },
      }),
      async (c) => {
        return c.json(TuiHost.status())
      },
    )
    .get(
      "/host/snapshot",
      describeRoute({
        summary: "Get embedded TUI host snapshot",
        description: "Get the buffered terminal output for the embedded right-sidebar TUI host.",
        operationId: "tui.host.snapshot",
        responses: {
          200: {
            description: "Embedded TUI host snapshot",
            content: { "application/json": { schema: resolver(TuiHostSnapshot) } },
          },
        },
      }),
      async (c) => {
        return c.json(TuiHost.snapshot())
      },
    )
    .get(
      "/host/output",
      describeRoute({
        summary: "Get embedded TUI host output delta",
        description:
          "Get buffered terminal output after a cursor for the embedded right-sidebar TUI host. Cursor -1 starts at the current end.",
        operationId: "tui.host.output",
        responses: {
          200: {
            description: "Embedded TUI host output delta",
            content: { "application/json": { schema: resolver(TuiHostOutput) } },
          },
          ...errors(400),
        },
      }),
      validator("query", z.object({ cursor: z.coerce.number().int().min(-1).optional() })),
      async (c) => {
        return c.json(TuiHost.output(c.req.valid("query")))
      },
    )
    .post(
      "/host/input",
      describeRoute({
        summary: "Write input to embedded TUI host",
        description: "Write terminal input to the project-bound embedded TUI host.",
        operationId: "tui.host.input",
        responses: {
          200: {
            description: "Input written",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ data: z.string().min(1) })),
      async (c) => {
        try {
          return c.json(TuiHost.input(c.req.valid("json").data))
        } catch (error) {
          mapTuiHostRouteError(error)
        }
      },
    )
    .post(
      "/host/resize",
      describeRoute({
        summary: "Resize embedded TUI host",
        description: "Resize the Pseudo Terminal (PTY) used by the embedded right-sidebar TUI host.",
        operationId: "tui.host.resize",
        responses: {
          200: {
            description: "Embedded TUI host resized",
            content: { "application/json": { schema: resolver(TuiHostInfo) } },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          cols: z.number().int().min(1).max(500),
          rows: z.number().int().min(1).max(200),
        }),
      ),
      async (c) => {
        try {
          return c.json(TuiHost.resize(c.req.valid("json")))
        } catch (error) {
          mapTuiHostRouteError(error)
        }
      },
    )
    .post(
      "/host/stop",
      describeRoute({
        summary: "Stop embedded TUI host",
        description: "Stop the project-bound embedded TUI host.",
        operationId: "tui.host.stop",
        responses: {
          200: {
            description: "Embedded TUI host stopped",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await TuiHost.stop())
      },
    )
    // === runtime: lifecycle ===
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
        return c.json(await TuiRuntime.start({ ...body, directory: Instance.directory }))
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
    )
    // === runtime: status (sessions + commands) ===
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
    // === runtime: task ===
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
                    taskID: z.string().nullable(),
                    waited: z.boolean(),
                    completed: z.boolean(),
                    message: z.unknown().nullable(),
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
          timeoutMs: z
            .number()
            .int()
            .min(1000)
            .max(60 * 60 * 1000)
            .default(5 * 60 * 1000)
            .optional(),
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
                schema: resolver(z.unknown()),
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
          body: z.unknown().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await TuiRuntime.proxy(body))
      },
    )
    .post(
      "/runtime/task-status",
      describeRoute({
        summary: "Get runtime task status",
        description: "Resolve queued task status by taskID for watchdogs and recovery.",
        operationId: "tui.runtime.taskStatus",
        responses: {
          200: {
            description: "Task status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    found: z.boolean(),
                    taskID: z.string(),
                    sessionID: z.string().nullable(),
                    status: z.string(),
                    terminal: z.boolean(),
                    error: z.string().nullable(),
                    updatedAt: z.number().nullable(),
                    completedAt: z.number().nullable(),
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
          taskID: z.string().min(1),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(TuiRuntime.taskStatus(body))
      },
    )
    // === action: dialog ===
    .post(
      "/open-help",
      describeRoute({
        summary: "Open help dialog",
        description: "Open the help dialog in the TUI to display user assistance information.",
        operationId: "tui.openHelp",
        responses: {
          200: {
            description: "Help dialog opened successfully",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.help })
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
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.sessions })
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
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.themes })
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
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.action.models })
        return c.json(true)
      },
    )
    // === action: event ===
    .post(
      "/execute-command",
      describeRoute({
        summary: "Execute TUI command",
        description: "Execute a TUI command (e.g. agent_cycle)",
        operationId: "tui.executeCommand",
        responses: {
          200: {
            description: "Command executed successfully",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ command: z.string() })),
      async (c) => {
        const command = c.req.valid("json").command
        await Bus.publish(TuiEvent.CommandExecute, { command: TuiCommand.normalize(command) })
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
            content: { "application/json": { schema: resolver(z.boolean()) } },
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
            content: { "application/json": { schema: resolver(z.boolean()) } },
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
            content: { "application/json": { schema: resolver(z.boolean()) } },
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
    // === control: queue plumbing ===
    .get(
      "/control/next",
      describeRoute({
        summary: "Get next TUI request",
        description: "Retrieve the next TUI (Terminal User Interface) request from the queue for processing.",
        operationId: "tui.control.next",
        responses: {
          200: {
            description: "Next TUI request",
            content: { "application/json": { schema: resolver(TuiControlRequest) } },
          },
        },
      }),
      async (c) => {
        try {
          const req = await nextRequest(c.req.raw.signal)
          return c.json(req)
        } catch (error) {
          if (error instanceof Error && error.message === NEXT_ABORTED) {
            return c.body(null, 408)
          }
          throw error
        }
      },
    )
    .post(
      "/control/response",
      describeRoute({
        summary: "Submit TUI response",
        description: "Submit a response to the TUI request queue to complete a pending request.",
        operationId: "tui.control.response",
        responses: {
          200: {
            description: "Response submitted successfully",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      validator("json", TuiControlResponse),
      async (c) => {
        const body = c.req.valid("json")
        const match = pending.get(body.id)
        if (!match) {
          return c.json(false, 404)
        }
        pending.delete(body.id)
        dropRequest(body.id)
        clearTimeout(match.timeout)
        if (body.error !== undefined) {
          match.reject(new Error(body.error))
        } else {
          match.resolve(body.body)
        }
        return c.json(true)
      },
    ),
)
