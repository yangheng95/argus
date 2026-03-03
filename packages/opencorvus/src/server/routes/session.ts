import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { SessionProxyMiddleware } from "../../control-plane/session-proxy-middleware"
import { SessionInteractionRoutes } from "./session-interaction"
import { SessionManagementRoutes } from "./session-management"

export const SessionRoutes = lazy(() =>
  new Hono()
    .use(SessionProxyMiddleware)
    .route("/", SessionManagementRoutes())
    .route("/", SessionInteractionRoutes()),
)
