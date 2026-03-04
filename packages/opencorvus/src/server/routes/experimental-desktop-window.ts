import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { WindowManager } from "../../opencorvus/perception/window"
import { MonitorManager } from "../../opencorvus/perception/monitor"
import { GuiState } from "../../tool/gui-state"
import { DesktopState } from "../../tool/desktop-state"

export function ExperimentalDesktopWindowRoutes() {
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
        MonitorManager.unbind()
        DesktopState.bindWindow(binding.windowId, binding.info.title)
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
}
