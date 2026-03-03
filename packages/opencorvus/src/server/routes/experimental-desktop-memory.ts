import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { WindowManager } from "../../opencorvus/perception/window"
import { GuiState } from "../../tool/gui-state"
import { DesktopState } from "../../tool/desktop-state"
import { Memory } from "../../memory"

export function ExperimentalDesktopMemoryRoutes() {
  return new Hono()
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
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.number(),
                      title: z.string(),
                      appName: z.string(),
                    }),
                  ),
                ),
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
        description:
          "Bind to a desktop window by window_id (preferred) or title substring. Activates GUI state and sets the window as the target for screenshots and input.",
        operationId: "experimental.bind_window",
        responses: {
          200: {
            description: "Window bound",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    windowId: z.number(),
                    matchTitle: z.string(),
                    title: z.string(),
                    appName: z.string(),
                    focused: z.boolean(),
                    selectionMode: z.enum(["window_id", "title"]),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "json",
        z
          .object({
            window_id: z
              .union([z.number().int(), z.string().trim().regex(/^\d+$/)])
              .transform((v) => (typeof v === "string" ? Number(v) : v))
              .optional(),
            title: z.string().optional(),
          })
          .refine((v) => typeof v.window_id === "number" || !!v.title?.trim(), {
            message: "Provide window_id or title",
          }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        GuiState.activate()
        const selectionMode = typeof body.window_id === "number" ? "window_id" : "title"
        const binding =
          typeof body.window_id === "number"
            ? await WindowManager.bindById(body.window_id, body.title)
            : await WindowManager.bind(body.title!.trim())
        DesktopState.setBounds(null)
        const refreshed = await WindowManager.getBinding()
        return c.json({
          windowId: binding.windowId,
          matchTitle: binding.matchTitle,
          title: binding.info.title,
          appName: binding.info.appName,
          focused: refreshed?.info.isFocused ?? binding.info.isFocused,
          selectionMode,
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
}
