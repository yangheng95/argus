import { Hono } from "hono"
import { lazy } from "../../../util/lazy"
import { SessionMutateCoreRoutes } from "./mutate-core"
import { SessionMutateFlowRoutes } from "./mutate-flow"

export const SessionMutateRoutes = lazy(() =>
  new Hono().route("/", SessionMutateCoreRoutes()).route("/", SessionMutateFlowRoutes()),
)
