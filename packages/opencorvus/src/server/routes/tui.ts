import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { TuiRuntimeRoutes } from "./tui-runtime"
import { TuiActionRoutes } from "./tui-action"
import { TuiControlRoutes } from "./tui-control"

export { callTui } from "./tui-control"

export const TuiRoutes = lazy(() =>
  new Hono().route("/", TuiRuntimeRoutes()).route("/", TuiActionRoutes()).route("/control", TuiControlRoutes()),
)
