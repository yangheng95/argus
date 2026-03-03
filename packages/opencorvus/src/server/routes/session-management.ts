import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { SessionManagementQueryRoutes } from "./session-management-query"
import { SessionManagementMutateRoutes } from "./session-management-mutate"
import { SessionManagementShareRoutes } from "./session-management-share"

export const SessionManagementRoutes = lazy(() =>
  new Hono()
    .route("/", SessionManagementQueryRoutes())
    .route("/", SessionManagementMutateRoutes())
    .route("/", SessionManagementShareRoutes()),
)
