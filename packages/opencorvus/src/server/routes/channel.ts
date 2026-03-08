import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { ChannelRegistry } from "@/channel/registry"
import { lazy } from "../../util/lazy"

export const ChannelRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "List channels",
      description: "Get available channel integrations and their configuration status.",
      operationId: "channel.list",
      responses: {
        200: {
          description: "List of channels",
          content: {
            "application/json": {
              schema: resolver(ChannelRegistry.Info.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await ChannelRegistry.list())
    },
  ),
)
