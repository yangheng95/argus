import { Hono } from "hono"
import { CronScheduleRoutes } from "./cron-schedule"
import { EventScheduleRoutes } from "./event-schedule"
import { MemoryViewRoutes } from "./memory-view"

export function ScheduleRoutes() {
  return new Hono()
    .route("/", CronScheduleRoutes())
    .route("/", EventScheduleRoutes())
    .route("/", MemoryViewRoutes())
}
