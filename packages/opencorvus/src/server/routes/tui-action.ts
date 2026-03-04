import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { TuiActionInputRoutes } from "./tui-action-input"
import { TuiActionDialogRoutes } from "./tui-action-dialog"
import { TuiActionEventRoutes } from "./tui-action-event"

export const TuiActionRoutes = lazy(() =>
  new Hono().route("/", TuiActionInputRoutes()).route("/", TuiActionDialogRoutes()).route("/", TuiActionEventRoutes()),
)
