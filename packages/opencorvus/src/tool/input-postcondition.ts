import { Automation } from "../opencorvus/automation"
import { DesktopState } from "./desktop-state"
import { WindowManager } from "../opencorvus/perception/window"

export namespace InputPostcondition {
  export type Name = "none" | "bound_window_foreground"

  export interface Opt {
    binding?: Awaited<ReturnType<typeof WindowManager.getBinding>> | null
    target?: ReturnType<typeof DesktopState.getTarget>
  }

  export function resolve(name: Name | undefined, opt: Opt = {}) {
    if (!name || name === "none") return undefined
    if (name === "bound_window_foreground") return () => boundWindowForeground(opt)
    return undefined
  }

  export async function boundWindowForeground(opt: Opt = {}): Promise<Automation.Probe> {
    const target = opt.target ?? DesktopState.getTarget()
    if (target?.scope !== "window") return { ok: true }
    const binding = opt.binding ?? await WindowManager.getBinding()
    if (!binding) {
      return {
        ok: false,
        kind: "state_mismatch",
        detail: "bound window disappeared after action",
      }
    }
    if (typeof target.windowId === "number" && binding.windowId !== target.windowId) {
      return {
        ok: false,
        kind: "state_mismatch",
        detail: "bound window drifted after action",
      }
    }
    const focused = await WindowManager.ensureBoundForeground(binding)
    if (focused) return { ok: true }
    return {
      ok: false,
      kind: "state_mismatch",
      detail: "bound window lost foreground after action",
    }
  }
}
