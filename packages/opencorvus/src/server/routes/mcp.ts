import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { McpCoreRoutes } from "./mcp-core"
import { McpAuthRoutes } from "./mcp-auth"
import { McpConnectionRoutes } from "./mcp-connection"

export const McpRoutes = lazy(() =>
  new Hono()
    .route("/", McpCoreRoutes())
    .route("/", McpAuthRoutes())
    .route("/", McpConnectionRoutes()),
)
