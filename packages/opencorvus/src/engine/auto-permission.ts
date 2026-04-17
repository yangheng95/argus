/**
 * Auto-approval of permission requests.
 *
 * Fine-grained switch: when `experimental.auto_permission === true` in
 * opencorvus.jsonc, an agent that raises `PermissionNext.Event.Asked` is
 * auto-replied with "once" so the run proceeds without blocking on operator
 * input. Replaces the older `experimental.unattended` blanket flag — that
 * flag also suppressed clarification questions and forced all prompts into
 * "assumed" text, which was too coarse. The split lets operators keep
 * permission-prompt auto-approval while still receiving genuine
 * clarification questions in the overlay.
 *
 * The `autoReply: true` flag propagates through PermissionNext.Event.Replied
 * → EngineInteraction.resolvePermission → interaction response metadata,
 * so the overlay can display "[auto-reply]" in the transcript.
 */
import { Bus } from "@/bus"
import { PermissionNext } from "@/permission/next"
import { Log } from "@/util/log"
import { Config } from "@/config/config"
import { activeRunBySession } from "./store"

const log = Log.create({ service: "engine.auto-permission" })

async function handlePermissionAsked(request: PermissionNext.Request) {
  const cfg = await Config.get()
  if (cfg.experimental?.auto_permission !== true) return
  const run = activeRunBySession(request.sessionID)
  if (!run) return // not an orchestrator session

  log.info("auto-approving permission", {
    permissionID: request.id,
    runID: run.id,
    permission: request.permission,
  })

  try {
    await PermissionNext.reply({
      requestID: request.id,
      reply: "once",
      autoReply: true,
    })
  } catch (err) {
    log.debug("auto-approve delivery failed (permission may be resolved)", { error: String(err) })
  }
}

export namespace AutoPermission {
  let subscribed = false

  export function subscribe() {
    if (subscribed) return
    subscribed = true
    Bus.subscribe(PermissionNext.Event.Asked, ({ properties }) => {
      void handlePermissionAsked(properties)
    })
    log.info("auto-permission subscriptions active")
  }
}
