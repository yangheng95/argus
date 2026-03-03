import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { TuiRuntimeLifecycleRoutes } from "./tui-runtime-lifecycle"
import { TuiRuntimeStatusRoutes } from "./tui-runtime-status"
import { TuiRuntimeTaskRoutes } from "./tui-runtime-task"

export const TuiRuntimeRoutes = lazy(() =>
  new Hono()
    .route("/", TuiRuntimeLifecycleRoutes())
    .route("/", TuiRuntimeStatusRoutes())
    .route("/", TuiRuntimeTaskRoutes()),
)
