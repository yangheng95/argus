import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { SessionInteractionRoutes } from "./session-interaction"
import { SessionManagementRoutes } from "./session-management"

export const SessionRoutes = lazy(() =>
  new Hono().route("/", SessionManagementRoutes()).route("/", SessionInteractionRoutes()),
)
