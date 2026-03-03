import { Hono } from "hono"
import { ExperimentalCronScheduleRoutes } from "./experimental-cron-schedule"
import { ExperimentalEventScheduleRoutes } from "./experimental-event-schedule"
import { ExperimentalMemoryViewRoutes } from "./experimental-memory-view"

export function ExperimentalScheduleRoutes() {
  return new Hono()
    .route("/", ExperimentalCronScheduleRoutes())
    .route("/", ExperimentalEventScheduleRoutes())
    .route("/", ExperimentalMemoryViewRoutes())
}
