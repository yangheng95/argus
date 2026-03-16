import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { ToolWorktreeRoutes } from "./experimental/tool-worktree"
import { ResourceRoutes } from "./experimental/resource"
import { ScheduleRoutes } from "./experimental/schedule"

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .route("/", ToolWorktreeRoutes())
    .route("/", ResourceRoutes())
    .route("/", ScheduleRoutes()),
)
