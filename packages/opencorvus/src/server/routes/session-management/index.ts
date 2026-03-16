import { Hono } from "hono"
import { lazy } from "../../../util/lazy"
import { SessionQueryRoutes } from "./query"
import { SessionMutateRoutes } from "./mutate"
import { SessionShareRoutes } from "./share"
import { SessionPanelSettingsRoutes } from "./panel-settings"

export const SessionManagementRoutes = lazy(() =>
  new Hono()
    .route("/", SessionQueryRoutes())
    .route("/", SessionMutateRoutes())
    .route("/", SessionPanelSettingsRoutes())
    .route("/", SessionShareRoutes()),
)
