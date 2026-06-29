import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "../../mcp"
import { Config } from "../../config/config"
import { errors, namedErrorResponse } from "../error"
import { lazy } from "../../util/lazy"

export const McpRoutes = lazy(() => {
  const app = new Hono()
  function badRequest(message: string) {
    return {
      data: { message },
      errors: [{ message }],
      success: false as const,
    }
  }
  return (
    app
      // === core ===
      .get(
        "/",
        describeRoute({
          summary: "Get MCP status",
          description: "Get the status of all Model Context Protocol (MCP) servers.",
          operationId: "mcp.status",
          responses: {
            200: {
              description: "MCP server status",
              content: {
                "application/json": {
                  schema: resolver(z.record(z.string(), MCP.Status)),
                },
              },
            },
          },
        }),
        async (c) => {
          return c.json(await MCP.status())
        },
      )
      .post(
        "/",
        describeRoute({
          summary: "Add MCP server",
          description: "Dynamically add a new Model Context Protocol (MCP) server to the system.",
          operationId: "mcp.add",
          responses: {
            200: {
              description: "MCP server added successfully",
              content: {
                "application/json": {
                  schema: resolver(z.record(z.string(), MCP.Status)),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "json",
          z.object({
            name: z.string(),
            config: Config.Mcp,
          }),
        ),
        async (c) => {
          const { name, config } = c.req.valid("json")
          const result = await MCP.add(name, config)
          return c.json(result.status)
        },
      )
      // === auth ===
      .post(
        "/:name/auth",
        describeRoute({
          summary: "Start MCP OAuth",
          description: "Start OAuth authentication flow for a Model Context Protocol (MCP) server.",
          operationId: "mcp.auth.start",
          responses: {
            200: {
              description: "OAuth flow started",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      authorizationUrl: z.string().describe("URL to open in browser for authorization"),
                    }),
                  ),
                },
              },
            },
            ...errors(400, 404),
            500: namedErrorResponse("MCP OAuth start failed", "UnknownError"),
          },
        }),
        async (c) => {
          const name = c.req.param("name")
          const supportsOAuth = await MCP.supportsOAuth(name)
          if (!supportsOAuth) {
            return c.json(badRequest(`MCP server ${name} does not support OAuth`), 400)
          }
          const result = await MCP.startAuth(name)
          return c.json(result)
        },
      )
      .post(
        "/:name/auth/callback",
        describeRoute({
          summary: "Complete MCP OAuth",
          description:
            "Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.",
          operationId: "mcp.auth.callback",
          responses: {
            200: {
              description: "OAuth authentication completed",
              content: {
                "application/json": {
                  schema: resolver(MCP.Status),
                },
              },
            },
            400: namedErrorResponse("Invalid MCP OAuth callback request", "BadRequestError", "MCPOAuthStateError"),
            ...errors(404),
            500: namedErrorResponse("MCP OAuth completion failed", "UnknownError"),
          },
        }),
        validator(
          "json",
          z.object({
            code: z.string().describe("Authorization code from OAuth callback"),
            state: z.string().describe("OAuth state parameter from OAuth callback"),
          }),
        ),
        async (c) => {
          const name = c.req.param("name")
          const { code, state } = c.req.valid("json")
          const status = await MCP.finishAuthCallback(name, code, state)
          return c.json(status)
        },
      )
      .post(
        "/:name/auth/authenticate",
        describeRoute({
          summary: "Authenticate MCP OAuth",
          description: "Start OAuth flow and wait for callback (opens browser)",
          operationId: "mcp.auth.authenticate",
          responses: {
            200: {
              description: "OAuth authentication completed",
              content: {
                "application/json": {
                  schema: resolver(MCP.Status),
                },
              },
            },
            ...errors(400, 404),
            500: namedErrorResponse("MCP OAuth completion failed", "UnknownError"),
          },
        }),
        async (c) => {
          const name = c.req.param("name")
          const supportsOAuth = await MCP.supportsOAuth(name)
          if (!supportsOAuth) {
            return c.json(badRequest(`MCP server ${name} does not support OAuth`), 400)
          }
          const status = await MCP.authenticate(name)
          return c.json(status)
        },
      )
      .delete(
        "/:name/auth",
        describeRoute({
          summary: "Remove MCP OAuth",
          description: "Remove OAuth credentials for an MCP server",
          operationId: "mcp.auth.remove",
          responses: {
            200: {
              description: "OAuth credentials removed",
              content: {
                "application/json": {
                  schema: resolver(z.object({ success: z.literal(true) })),
                },
              },
            },
            ...errors(404, 500),
          },
        }),
        async (c) => {
          const name = c.req.param("name")
          await MCP.removeAuth(name)
          return c.json({ success: true as const })
        },
      )
      // === connection ===
      .post(
        "/:name/connect",
        describeRoute({
          description: "Connect an MCP server",
          operationId: "mcp.connect",
          responses: {
            200: {
              description: "MCP server connected successfully",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(404),
            500: namedErrorResponse("MCP connection failed", "UnknownError"),
          },
        }),
        validator("param", z.object({ name: z.string() })),
        async (c) => {
          const { name } = c.req.valid("param")
          await MCP.connect(name)
          return c.json(true)
        },
      )
      .post(
        "/:name/disconnect",
        describeRoute({
          description: "Disconnect an MCP server",
          operationId: "mcp.disconnect",
          responses: {
            200: {
              description: "MCP server disconnected successfully",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(404),
          },
        }),
        validator("param", z.object({ name: z.string() })),
        async (c) => {
          const { name } = c.req.valid("param")
          await MCP.disconnect(name)
          return c.json(true)
        },
      )
  )
})
