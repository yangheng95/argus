import { Automation } from "../engine"

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

export namespace DesktopDriver {
  export interface CheckInput {
    check: Automation.Check
    stage: "pre" | "post"
  }

  export interface Opt {
    id: string
    action: () => Promise<void>
    recover?: () => Promise<Automation.Probe | boolean>
    check?: (input: CheckInput) => Promise<Automation.Probe | boolean>
    classify?: (error: unknown) => Automation.ErrorKind
    describe?: (error: unknown) => string
  }

  function probe(input: unknown) {
    if (typeof input !== "object" || !input) return null
    if (!("ok" in input)) return null
    return input as Automation.Probe
  }

  export function create(input: Opt): Automation.Driver {
    const classify = input.classify ?? kind
    const describe = input.describe ?? text
    return {
      locate: async () => ({
        ok: true,
        data: { id: input.id },
      }),
      check: async (ctx) => {
        if (!input.check) return { ok: true } satisfies Automation.Probe
        const result = await input.check({
          check: ctx.check,
          stage: ctx.stage,
        })
        const value = probe(result)
        if (value) return value
        if (result === true) return { ok: true } satisfies Automation.Probe
        return {
          ok: false,
          kind: "state_mismatch",
          detail: `${ctx.stage} check failed`,
        } satisfies Automation.Probe
      },
      act: async () => {
        try {
          await input.action()
          return { ok: true }
        } catch (error) {
          return {
            ok: false,
            kind: classify(error),
            detail: describe(error),
          } satisfies Automation.Probe
        }
      },
      recover: async () => {
        if (!input.recover) return { ok: true } satisfies Automation.Probe
        const result = await input.recover()
        const value = probe(result)
        if (value) return value
        if (result === true) return { ok: true } satisfies Automation.Probe
        return {
          ok: false,
          kind: "state_mismatch",
          detail: "desktop recovery failed",
        } satisfies Automation.Probe
      },
    }
  }
}
