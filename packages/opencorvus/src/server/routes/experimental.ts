import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { ExperimentalToolWorktreeRoutes } from "./experimental-tool-worktree"
import { ExperimentalResourceRoutes } from "./experimental-session-resource"
import { ExperimentalScheduleRoutes } from "./experimental-schedule"

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .route("/", ExperimentalToolWorktreeRoutes())
    .route("/", ExperimentalResourceRoutes())
    .route("/", ExperimentalScheduleRoutes()),
)
