import type { Automation } from "../opencorvus/automation"
import type { DriverKind } from "../opencorvus/automation"
import { runInputAction } from "./input-action-engine"
import { showOverlay } from "./overlay-client"
import { Log } from "../util/log"

const log = Log.create({ service: "input-pipeline" })

type Overlay = {
  x?: number
  y?: number
  action: string
  label: string
}

type Run = {
  id: string
  action: string
  abort: AbortSignal
  driver?: DriverKind
  act?: Automation.Action
  post?: () => Promise<Automation.Probe | boolean>
  run: () => Promise<void>
  start: Overlay
  done?: Overlay
  retryMeta?: Record<string, unknown>
}

export async function runInputPipeline(input: Run) {
  showOverlay(input.start.x, input.start.y, input.start.action, input.start.label)
  const result = await runInputAction({
    id: input.id,
    abort: input.abort,
    driver: input.driver,
    act: input.act,
    post: input.post,
    action: input.run,
  })
  if (result.tries > 1) {
    log.warn("input-action-retried", {
      action: input.action,
      tries: result.tries,
      ...(input.retryMeta ?? {}),
    })
  }
  const done = input.done ?? {
    x: input.start.x,
    y: input.start.y,
    action: input.start.action,
    label: "done",
  }
  showOverlay(done.x, done.y, done.action, done.label, "done")
  return result
}

