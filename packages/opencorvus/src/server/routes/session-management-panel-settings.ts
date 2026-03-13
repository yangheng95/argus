import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { PanelSettings } from "@/panel/settings"
import { Session } from "@/session"
import { errors } from "../error"

export const SessionManagementPanelSettingsRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID/panel-settings",
      describeRoute({
        summary: "Get session panel settings",
        description: "Read session-scoped overlay panel settings.",
        operationId: "session.panelSettings.get",
        responses: {
          200: {
            description: "Session panel settings",
            content: {
              "application/json": {
                schema: resolver(PanelSettings.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: Session.get.schema })),
      async (c) => {
        return c.json(await PanelSettings.get(c.req.valid("param").sessionID))
      },
    )
    .patch(
      "/:sessionID/panel-settings",
      describeRoute({
        summary: "Update session panel settings",
        description: "Update session-scoped overlay panel settings.",
        operationId: "session.panelSettings.update",
        responses: {
          200: {
            description: "Updated session panel settings",
            content: {
              "application/json": {
                schema: resolver(PanelSettings.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: Session.get.schema })),
      validator("json", PanelSettings.Update),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await PanelSettings.set(params.sessionID, body))
      },
    ),
)
