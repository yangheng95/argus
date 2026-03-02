import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ToolRegistry } from "../../tool/registry"
import { Worktree } from "../../worktree"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { Session } from "../../session"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { WorkspaceRoutes } from "./workspace"
import { WindowManager } from "../../argus/perception/window"
import { GuiState } from "../../tool/gui-state"
import { DesktopState } from "../../tool/desktop-state"
import { Memory } from "../../memory"
import { Database, and, eq } from "../../storage/db"
import { CronJobTable } from "../../scheduler/cron.sql"
import { EventJobTable } from "../../scheduler/event.sql"
import { Cron } from "../../scheduler/cron"
import { Identifier } from "../../id/id"
import { TaskPlan } from "../../memory/task-plan"
import { Scratchpad } from "../../memory/scratchpad"

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .get(
      "/tool/ids",
      describeRoute({
        summary: "List tool IDs",
        description:
          "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
        operationId: "tool.ids",
        responses: {
          200: {
            description: "Tool IDs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return c.json(await ToolRegistry.ids())
      },
    )
    .get(
      "/tool",
      describeRoute({
        summary: "List tools",
        description:
          "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
        operationId: "tool.list",
        responses: {
          200: {
            description: "Tools",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          description: z.string(),
                          parameters: z.any(),
                        })
                        .meta({ ref: "ToolListItem" }),
                    )
                    .meta({ ref: "ToolList" }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        const tools = await ToolRegistry.tools({ providerID: provider, modelID: model })
        return c.json(
          tools.map((t) => ({
            id: t.id,
            description: t.description,
            // Handle both Zod schemas and plain JSON schemas
            parameters: (t.parameters as any)?._def ? zodToJsonSchema(t.parameters as any) : t.parameters,
          })),
        )
      },
    )
    .post(
      "/worktree",
      describeRoute({
        summary: "Create worktree",
        description: "Create a new git worktree for the current project and run any configured startup scripts.",
        operationId: "worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: {
              "application/json": {
                schema: resolver(Worktree.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.create.schema),
      async (c) => {
        const body = c.req.valid("json")
        const worktree = await Worktree.create(body)
        return c.json(worktree)
      },
    )
    .route("/workspace", WorkspaceRoutes())
    .get(
      "/worktree",
      describeRoute({
        summary: "List worktrees",
        description: "List all sandbox worktrees for the current project.",
        operationId: "worktree.list",
        responses: {
          200: {
            description: "List of worktree directories",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        const sandboxes = await Project.sandboxes(Instance.project.id)
        return c.json(sandboxes)
      },
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove worktree",
        description: "Remove a git worktree and delete its branch.",
        operationId: "worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.remove.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.remove(body)
        await Project.removeSandbox(Instance.project.id, body.directory)
        return c.json(true)
      },
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset worktree",
        description: "Reset a worktree branch to the primary default branch.",
        operationId: "worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.reset.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.reset(body)
        return c.json(true)
      },
    )
    .get(
      "/session",
      describeRoute({
        summary: "List sessions",
        description:
          "Get a list of all Argus sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
        operationId: "experimental.session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.GlobalInfo.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          cursor: z.coerce
            .number()
            .optional()
            .meta({ description: "Return sessions updated before this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
          archived: z.coerce.boolean().optional().meta({ description: "Include archived sessions (default false)" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const limit = query.limit ?? 100
        const sessions: Session.GlobalInfo[] = []
        for await (const session of Session.listGlobal({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          cursor: query.cursor,
          search: query.search,
          limit: limit + 1,
          archived: query.archived,
        })) {
          sessions.push(session)
        }
        const hasMore = sessions.length > limit
        const list = hasMore ? sessions.slice(0, limit) : sessions
        if (hasMore && list.length > 0) {
          c.header("x-next-cursor", String(list[list.length - 1].time.updated))
        }
        return c.json(list)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP resources",
        description: "Get all available MCP resources from connected servers. Optionally filter by name.",
        operationId: "experimental.resource.list",
        responses: {
          200: {
            description: "MCP resources",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Resource)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.resources())
      },
    )
    .get(
      "/windows",
      describeRoute({
        summary: "List windows",
        description: "List all visible desktop windows.",
        operationId: "experimental.windows.list",
        responses: {
          200: {
            description: "Window list",
            content: {
              "application/json": {
                schema: resolver(z.array(z.object({
                  id: z.number(),
                  title: z.string(),
                  appName: z.string(),
                }))),
              },
            },
          },
        },
      }),
      async (c) => {
        const windows = await WindowManager.listWindows()
        return c.json(windows.map((w) => ({ id: w.id, title: w.title, appName: w.appName })))
      },
    )
    .post(
      "/bind_window",
      describeRoute({
        summary: "Bind window",
        description: "Bind to a desktop window by title substring. Activates GUI state and sets the window as the target for screenshots and input.",
        operationId: "experimental.bind_window",
        responses: {
          200: {
            description: "Window bound",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  windowId: z.number(),
                  matchTitle: z.string(),
                  title: z.string(),
                  appName: z.string(),
                  focused: z.boolean(),
                })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("json", z.object({ title: z.string() })),
      async (c) => {
        const { title } = c.req.valid("json")
        GuiState.activate()
        const binding = await WindowManager.bind(title)
        DesktopState.setBounds(null)
        const refreshed = await WindowManager.getBinding()
        return c.json({
          windowId: binding.windowId,
          matchTitle: binding.matchTitle,
          title: binding.info.title,
          appName: binding.info.appName,
          focused: refreshed?.info.isFocused ?? binding.info.isFocused,
        })
      },
    )
    // --- Memory API ---
    .get(
      "/memory",
      describeRoute({
        summary: "List memory files",
        operationId: "experimental.memory.list",
        responses: {
          200: {
            description: "Memory file list",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      title: z.string(),
                      source: z.string(),
                      timeCreated: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const files = Memory.listFiles(projectId)
        return c.json(files)
      },
    )
    .post(
      "/memory/search",
      describeRoute({
        summary: "Search memories",
        operationId: "experimental.memory.search",
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      chunkId: z.string(),
                      fileId: z.string(),
                      fileTitle: z.string(),
                      content: z.string(),
                      score: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          query: z.string(),
          projectId: z.string(),
          limit: z.number().int().min(1).max(50).optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const results = Memory.search(body)
        return c.json(results)
      },
    )
    .post(
      "/memory",
      describeRoute({
        summary: "Create memory file",
        operationId: "experimental.memory.create",
        responses: {
          200: {
            description: "Created memory file",
            content: {
              "application/json": {
                schema: resolver(z.object({ id: z.string(), title: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          title: z.string(),
          content: z.string(),
          projectId: z.string(),
          source: z.enum(["agent", "compaction", "user"]).optional(),
        }),
      ),
      async (c) => {
        const { title, content, projectId, source } = c.req.valid("json")
        const file = Memory.createFile({ title, source: source ?? "user", projectId })
        Memory.writeChunks(file.id, projectId, content)
        return c.json({ id: file.id, title: file.title })
      },
    )
    .delete(
      "/memory/:id",
      describeRoute({
        summary: "Delete memory file",
        operationId: "experimental.memory.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        Memory.deleteFile(id)
        return c.json({ ok: true })
      },
    )
    // --- Schedule API ---
    .get(
      "/schedule",
      describeRoute({
        summary: "List scheduled tasks",
        operationId: "experimental.schedule.list",
        responses: {
          200: {
            description: "Scheduled tasks",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      expression: z.string(),
                      prompt: z.string(),
                      enabled: z.boolean(),
                      oneShot: z.boolean(),
                      lastRun: z.number().nullable(),
                      nextRun: z.number(),
                      failureCount: z.number(),
                      lastError: z.string().nullable(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const jobs = Database.use((db) =>
          db.select().from(CronJobTable).where(eq(CronJobTable.project_id, projectId)).all(),
        )
        return c.json(
          jobs.map((j) => ({
            id: j.id,
            name: j.name,
            expression: j.expression,
            prompt: j.prompt,
            enabled: j.enabled,
            oneShot: j.one_shot,
            lastRun: j.last_run,
            nextRun: j.next_run,
            failureCount: j.failure_count,
            lastError: j.last_error ?? null,
          })),
        )
      },
    )
    .post(
      "/schedule",
      describeRoute({
        summary: "Create scheduled task",
        operationId: "experimental.schedule.create",
        responses: {
          200: {
            description: "Created task",
            content: {
              "application/json": {
                schema: resolver(z.object({ id: z.string(), name: z.string(), nextRun: z.number() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          expression: z.string(),
          prompt: z.string(),
          projectId: z.string(),
          sessionId: z.string().optional(),
          oneShot: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const parsed = Cron.parse(body.expression)
        const now = Date.now()
        const nextRun = Cron.nextRun(parsed, now)
        const id = Identifier.ascending("cron")
        const oneShot = body.oneShot ?? (parsed.type === "interval")
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: body.projectId,
              session_id: body.sessionId,
              name: body.name,
              expression: body.expression,
              prompt: body.prompt,
              enabled: true,
              one_shot: oneShot,
              next_run: nextRun,
            })
            .run(),
        )
        return c.json({ id, name: body.name, nextRun })
      },
    )
    .delete(
      "/schedule/:id",
      describeRoute({
        summary: "Cancel scheduled task",
        operationId: "experimental.schedule.delete",
        responses: {
          200: {
            description: "Cancelled",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const id = c.req.param("id")
        Database.use((db) =>
          db
            .delete(CronJobTable)
            .where(and(eq(CronJobTable.id, id), eq(CronJobTable.project_id, projectId)))
            .run(),
        )
        return c.json({ ok: true })
      },
    )
    .get(
      "/event-schedule",
      describeRoute({
        summary: "List event-triggered tasks",
        operationId: "experimental.eventschedule.list",
        responses: {
          200: {
            description: "Event-triggered tasks",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      eventType: z.string(),
                      match: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
                      prompt: z.string(),
                      enabled: z.boolean(),
                      oneShot: z.boolean(),
                      cooldownMs: z.number(),
                      lastRun: z.number().nullable(),
                      lastEvent: z.string().nullable(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const jobs = Database.use((db) =>
          db.select().from(EventJobTable).where(eq(EventJobTable.project_id, projectId)).all(),
        )
        return c.json(
          jobs.map((j) => ({
            id: j.id,
            name: j.name,
            eventType: j.event_type,
            match: j.match_json ?? {},
            prompt: j.prompt,
            enabled: j.enabled,
            oneShot: j.one_shot,
            cooldownMs: j.cooldown_ms,
            lastRun: j.last_run,
            lastEvent: j.last_event ?? null,
          })),
        )
      },
    )
    .post(
      "/event-schedule",
      describeRoute({
        summary: "Create event-triggered task",
        operationId: "experimental.eventschedule.create",
        responses: {
          200: {
            description: "Created event task",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    eventType: z.string(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          eventType: z.string(),
          match: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
          prompt: z.string(),
          projectId: z.string(),
          sessionId: z.string().optional(),
          oneShot: z.boolean().optional(),
          cooldownMs: z.number().int().min(0).optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const id = Identifier.ascending("cron")
        Database.use((db) =>
          db
            .insert(EventJobTable)
            .values({
              id,
              project_id: body.projectId,
              session_id: body.sessionId,
              name: body.name,
              event_type: body.eventType,
              match_json: body.match,
              prompt: body.prompt,
              enabled: true,
              one_shot: body.oneShot ?? false,
              cooldown_ms: body.cooldownMs ?? 0,
            })
            .run(),
        )
        return c.json({ id, name: body.name, eventType: body.eventType })
      },
    )
    .delete(
      "/event-schedule/:id",
      describeRoute({
        summary: "Cancel event-triggered task",
        operationId: "experimental.eventschedule.delete",
        responses: {
          200: {
            description: "Cancelled",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const id = c.req.param("id")
        Database.use((db) =>
          db
            .delete(EventJobTable)
            .where(and(eq(EventJobTable.id, id), eq(EventJobTable.project_id, projectId)))
            .run(),
        )
        return c.json({ ok: true })
      },
    )
    // --- Task Plan API ---
    .get(
      "/task-plan",
      describeRoute({
        summary: "List tasks for a session",
        operationId: "experimental.taskplan.list",
        responses: {
          200: {
            description: "Tasks",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      goal: z.string(),
                      status: z.string(),
                      parentID: z.string().nullable(),
                      progressPct: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ sessionId: z.string() })),
      async (c) => {
        const { sessionId } = c.req.valid("query")
        const tasks = TaskPlan.list(sessionId)
        return c.json(tasks)
      },
    )
    // --- Scratchpad API ---
    .get(
      "/scratchpad",
      describeRoute({
        summary: "Get scratchpad content",
        operationId: "experimental.scratchpad.get",
        responses: {
          200: {
            description: "Scratchpad",
            content: { "application/json": { schema: resolver(z.object({ content: z.string() })) } },
          },
        },
      }),
      validator("query", z.object({ sessionId: z.string() })),
      async (c) => {
        const { sessionId } = c.req.valid("query")
        return c.json({ content: Scratchpad.get(sessionId) })
      },
    ),
)
