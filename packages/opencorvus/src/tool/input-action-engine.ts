import { Automation } from "../opencorvus/automation"
import { WindowManager } from "../opencorvus/perception/window"

function text(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function kind(error: unknown): Automation.ErrorKind {
  const value = text(error).toLowerCase()
  if (value.includes("abort")) return "aborted"
  if (value.includes("not found")) return "not_found"
  if (
    value.includes("foreground")
    || value.includes("focus")
    || value.includes("interact")
    || value.includes("click")
    || value.includes("keyboard")
    || value.includes("mouse")
  ) {
    return "not_interactable"
  }
  return "infra"
}

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
}) {
  const max = input.retryMax ?? 2
  const backoff = input.backoffMs ?? [80, 180]
  const engine = Automation.create(
    {
      locate: async () => ({
        ok: true,
        data: { id: input.id },
      }),
      check: async () => ({ ok: true }),
      act: async () => {
        try {
          await input.action()
          return { ok: true }
        } catch (error) {
          return {
            ok: false,
            kind: kind(error),
            detail: text(error),
          } satisfies Automation.Probe
        }
      },
      recover,
    },
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
      act: { kind: "custom", name: input.id },
      retry: {
        max,
        backoffMs: backoff,
      },
    },
    { abort: input.abort },
  )
  if (result.ok) return result
  const error = new Error(result.detail ?? `${input.id} failed`)
  Object.assign(error, { cause: result })
  throw error
}

