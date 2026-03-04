import {
  Automation,
  AutomationRuntime,
  DesktopDriver,
  DriverKind,
  selectDriver,
} from "../opencorvus/automation"
import { WindowManager } from "../opencorvus/perception/window"

async function recover() {
  const binding = await WindowManager.getBinding()
  if (!binding) return { ok: true } satisfies Automation.Probe
  const focused = await WindowManager.ensureBoundForeground(binding)
  if (focused) return { ok: true } satisfies Automation.Probe
  return {
    ok: false,
    kind: "state_mismatch",
    detail: "bound_window_not_foreground",
  } satisfies Automation.Probe
}

export async function runInputAction(input: {
  id: string
  action: () => Promise<void>
  abort: AbortSignal
  retryMax?: number
  backoffMs?: number[]
  driver?: DriverKind
  act?: Automation.Action
  post?: () => Promise<Automation.Probe | boolean>
}) {
  const max = input.retryMax ?? 2
  const backoff = input.backoffMs ?? [80, 180]
  const selected = selectDriver(AutomationRuntime.merge({
    kind: input.driver,
    desktop: DesktopDriver.create({
      id: input.id,
      action: input.action,
      recover,
      check: async (ctx) => {
        if (ctx.stage !== "post") return { ok: true }
        if (!input.post) return { ok: true }
        return input.post()
      },
    }),
  }))
  const act = input.act ?? { kind: "custom", name: input.id } satisfies Automation.Action
  if (selected.kind !== "desktop" && !input.act) {
    throw new Error(`input action ${input.id} requires explicit act for driver=${selected.kind}`)
  }
  const engine = Automation.create(
    selected.driver,
    {
      timeoutMs: 50,
      intervalMs: 0,
      retryMax: max,
      backoffMs: backoff,
    },
  )
  const result = await engine.run(
    {
      id: input.id,
      act,
      post: input.post
        ? [{ kind: "state", key: "post", value: true }]
        : undefined,
      retry: {
        max,
        backoffMs: backoff,
      },
    },
    { abort: input.abort },
  )
  if (result.ok) return result
  const error = new Error(result.detail ?? `${input.id} failed (${selected.kind})`)
  Object.assign(error, { cause: result })
  throw error
}
