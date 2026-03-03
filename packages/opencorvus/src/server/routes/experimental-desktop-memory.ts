import { Hono } from "hono"
import { ExperimentalDesktopWindowRoutes } from "./experimental-desktop-window"
import { ExperimentalMemoryStorageRoutes } from "./experimental-memory-storage"

export function ExperimentalDesktopMemoryRoutes() {
  return new Hono()
    .route("/", ExperimentalDesktopWindowRoutes())
    .route("/", ExperimentalMemoryStorageRoutes())
}
