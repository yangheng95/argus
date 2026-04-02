import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { TuiRuntimeRoutes } from "./tui-runtime"
import { TuiActionDialogRoutes } from "./tui-action-dialog"
import { TuiActionEventRoutes } from "./tui-action-event"
import { TuiControlRoutes } from "./tui-control"

export const TuiRoutes = lazy(() =>
  new Hono()
    .route("/", TuiRuntimeRoutes())
    .route("/", TuiActionDialogRoutes())
    .route("/", TuiActionEventRoutes())
    .route("/control", TuiControlRoutes()),
)
