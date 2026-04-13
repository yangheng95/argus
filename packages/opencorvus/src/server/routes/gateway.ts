/**
 * Gateway HTTP entry point.
 *
 *   POST /gateway/message
 *
 * Used by the overlay UI and other local clients to drive a Gateway dialog
 * directly. The route is project-scoped: the surrounding Instance.provide
 * (set up by the server's directory middleware) determines `defaultCwd`. The
 * caller supplies a userID so the per-(local, user) gateway session is the
 * same singleton across calls.
 */

import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Gateway } from "@/gateway"
import { Instance } from "@/project/instance"
import { channelKey } from "@/session/channel-key"
import { errors } from "../error"

export function GatewayRoutes() {
  return new Hono().post(
    "/message",
    describeRoute({
      summary: "Send a message to the Gateway dialog",
      description:
        "Routes user input through the Gateway dispatcher: it decides whether to enqueue a workflow task, dispatch a build task, answer a clarification, list state, or switch cwd. Returns the assistant reply text and a tool-call count.",
      operationId: "gateway.message",
      responses: {
        200: {
          description: "Gateway turn complete",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  sessionID: z.string(),
                  text: z.string(),
                  toolCalls: z.number().int().nonnegative(),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        text: z.string().min(1).meta({ description: "User text to dispatch." }),
        userID: z.string().min(1).meta({
          description:
            "Identity of the local user. Combined with the surrounding directory to derive the (local, userID) channel_key for the gateway session singleton.",
        }),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const ck = channelKey({ local: true, userID: body.userID })
      const result = await Gateway.handleMessage({
        channelKey: ck,
        defaultCwd: Instance.directory,
        text: body.text,
      })
      return c.json(result)
    },
  )
}
