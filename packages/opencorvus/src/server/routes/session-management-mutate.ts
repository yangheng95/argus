import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { SessionManagementMutateCoreRoutes } from "./session-management-mutate-core"
import { SessionManagementMutateFlowRoutes } from "./session-management-mutate-flow"

export const SessionManagementMutateRoutes = lazy(() =>
  new Hono()
    .route("/", SessionManagementMutateCoreRoutes())
    .route("/", SessionManagementMutateFlowRoutes()),
)
