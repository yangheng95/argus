import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { ChannelIngress, MessageInput, MessageResult } from "@/channel/ingress"
import { ChannelRegistry } from "@/channel/registry"
import { ChannelSupervisor } from "@/channel/supervisor"
import { lazy } from "../../util/lazy"

export const ChannelRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List channels",
        description: "Get available channel integrations, configuration status, and runtime status.",
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
    )
    .post(
      "/message",
      describeRoute({
        summary: "Handle channel message",
        description: "Bridge an external channel message into the task board and panel control workflow.",
        operationId: "channel.message",
        responses: {
          200: {
            description: "Message handled",
            content: {
              "application/json": {
                schema: resolver(MessageResult),
              },
            },
          },
        },
      }),
      validator("json", MessageInput),
      async (c) => {
        return c.json(await ChannelIngress.message(c.req.valid("json")))
      },
    )
    .get(
      "/runtime",
      describeRoute({
        summary: "Get managed channel runtime",
        description: "Get managed bot runtime status for Telegram and Discord channels.",
        operationId: "channel.runtime",
        responses: {
          200: {
            description: "Channel runtime status",
            content: {
              "application/json": {
                schema: resolver(
                  ChannelRegistry.Info.pick({ id: true }).omit({ id: true }).extend({
                    status: ChannelRegistry.Info.shape.runtime_status,
                    detail: ChannelRegistry.Info.shape.runtime_detail,
                    channels: ChannelRegistry.Info.shape.id.array(),
                    logs: ChannelRegistry.Info.shape.runtime_detail.array(),
                    running: ChannelRegistry.Info.shape.runtime_status.transform((item) => item === "running"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const current = await ChannelSupervisor.status()
        return c.json(current)
      },
    )
    .post(
      "/runtime/restart",
      describeRoute({
        summary: "Restart managed channel runtime",
        description: "Restart the managed Telegram and Discord bot runtime with the current config.",
        operationId: "channel.runtime.restart",
        responses: {
          200: {
            description: "Restarted channel runtime",
            content: {
              "application/json": {
                schema: resolver(
                  ChannelRegistry.Info.pick({ id: true }).omit({ id: true }).extend({
                    status: ChannelRegistry.Info.shape.runtime_status,
                    detail: ChannelRegistry.Info.shape.runtime_detail,
                    channels: ChannelRegistry.Info.shape.id.array(),
                    logs: ChannelRegistry.Info.shape.runtime_detail.array(),
                    running: ChannelRegistry.Info.shape.runtime_status.transform((item) => item === "running"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ChannelSupervisor.restart())
      },
    ),
)
