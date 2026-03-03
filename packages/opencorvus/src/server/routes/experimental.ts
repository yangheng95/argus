import { Hono } from "hono"
import { lazy } from "../../util/lazy"
import { ExperimentalToolWorktreeRoutes } from "./experimental-tool-worktree"
import { ExperimentalSessionResourceRoutes } from "./experimental-session-resource"
import { ExperimentalDesktopMemoryRoutes } from "./experimental-desktop-memory"
import { ExperimentalScheduleRoutes } from "./experimental-schedule"

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .route("/", ExperimentalToolWorktreeRoutes())
    .route("/", ExperimentalSessionResourceRoutes())
    .route("/", ExperimentalDesktopMemoryRoutes())
    .route("/", ExperimentalScheduleRoutes()),
)
