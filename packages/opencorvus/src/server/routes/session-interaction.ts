import { Hono } from "hono"
import { SessionInteractionMessageRoutes } from "./session-interaction-message"
import { SessionInteractionPromptRoutes } from "./session-interaction-prompt"
import { SessionInteractionRevertRoutes } from "./session-interaction-revert"

export function SessionInteractionRoutes() {
  return new Hono()
    .route("/", SessionInteractionMessageRoutes())
    .route("/", SessionInteractionPromptRoutes())
    .route("/", SessionInteractionRevertRoutes())
}
