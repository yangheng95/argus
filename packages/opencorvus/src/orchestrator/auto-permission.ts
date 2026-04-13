/**
 * Unattended auto-approval of permission requests.
 *
 * In unattended projects, agents that hit a `PermissionNext.Event.Asked`
 * (e.g. a write-tool needing user authorisation) would otherwise stall
 * waiting for input that will never come. This subscriber detects those
 * events and replies "once" so the agent proceeds.
 *
 * NOTE: Question (clarification) auto-reply lives in Gateway.notifier. This
 * file is intentionally permission-only — the two concerns shouldn't share a
 * surface (Gateway routes clarifications through user dialog when attended;
 * permissions never need that path).
 */
import { Bus } from "@/bus"
import { PermissionNext } from "@/permission/next"
import { Log } from "@/util/log"
import { unattendedProject } from "./unattended"
import { activeRunBySession } from "./store"
import { markInteraction } from "./interaction-actions"
import { findInteractionByExternal } from "./store"

const log = Log.create({ service: "orchestrator.auto-permission" })

async function handlePermissionAsked(request: PermissionNext.Request) {
  if (!(await unattendedProject())) return
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
    })
    const interaction = findInteractionByExternal(request.id)
    if (interaction && interaction.status === "pending") {
      markInteraction(interaction, "answered", {
        reply: "once",
        auto_reply: true,
      })
    }
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
