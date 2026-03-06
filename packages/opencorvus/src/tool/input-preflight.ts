import type { Coordinates } from "../opencorvus/gui/coordinates"
import { WindowManager } from "../opencorvus/perception/window"
import { Capability } from "../platform/capability"
import { resolveInputDriver } from "./input-action-engine"
import { InputGuard } from "./input-guard"
import { GuiState } from "./gui-state"

type Driver = InputGuard.Driver
type Block = InputGuard.Block
type Binding = Awaited<ReturnType<typeof WindowManager.getBinding>>
type Result<T> = { ok: true; value: T } | { ok: false; block: Block }

function capabilityBlock(action: string) {
  const item = Capability.cachedItem("desktop_input")
  if (!item || item.state !== "fail") return null
  const hint = item.hint ? ` Hint: ${item.hint}` : ""
  return {
    title: `Input action unavailable: ${action}`,
    output: `Cannot run input.${action}: ${item.detail}.${hint}`,
    metadata: {
      blocked: true,
      reason: "desktop_input_unavailable",
      action,
      capability: {
        id: item.id,
        state: item.state,
        detail: item.detail,
        hint: item.hint ?? null,
      },
    },
  } satisfies Block
}

function verificationBlock(action: string, coords?: { x: number; y: number }) {
  const gate = GuiState.verificationGate(action, coords)
  if (!gate) return null
  if (gate.reason === "verification_pending") {
    return {
      title: "Action blocked: screenshot verification required",
      output:
        `Cannot run input.${action} yet because the previous action "${gate.action}" has not been verified. ` +
        "Take screen.screenshot first to verify the previous action outcome, then continue.",
      metadata: {
        blocked: true,
        reason: gate.reason,
        action,
        pendingAction: gate.action,
        pendingStep: gate.step,
      },
    } satisfies Block
  }
  return {
    title: "Action blocked: recovery branch required",
    output:
      `Cannot repeat input.${action} with the same strategy because the previous verification is ${gate.status.toUpperCase()}. ` +
      `${gate.detail ?? "The last action outcome was not confirmed."} ` +
      "Take a recovery path (adjust coordinates, use keyboard alternative, re-bind window), then verify again with screen.screenshot.",
    metadata: {
      blocked: true,
      reason: gate.reason,
      action,
      previousAction: gate.action,
      previousStatus: gate.status,
      previousDetail: gate.detail,
      previousStep: gate.step,
      previousCoords: gate.coords,
    },
  } satisfies Block
}

export namespace InputPreflight {
  export async function pointer(
    action: "click" | "drag" | "move",
    driver: Driver,
    coords?: { x: number; y: number },
  ): Promise<
    Result<{
      anchored: Coordinates.WindowBounds
      binding: Binding
      driver: "desktop"
    }>
  > {
    const verifyBlocked = verificationBlock(action, coords)
    if (verifyBlocked) return { ok: false, block: verifyBlocked }
    const driverBlocked = InputGuard.pointerDriverBlock(action, driver)
    if (driverBlocked) return { ok: false, block: driverBlocked }
    const backendBlocked = capabilityBlock(action)
    if (backendBlocked) return { ok: false, block: backendBlocked }
    const anchored = InputGuard.requireBounds(action)
    if ("title" in anchored) return { ok: false, block: anchored }
    const binding = await WindowManager.getBinding()
    const anchorBlocked = InputGuard.ensureWindowAnchor(action, anchored, binding)
    if (anchorBlocked) return { ok: false, block: anchorBlocked }
    const windowBlocked = await InputGuard.ensureBoundWindowForeground(action, false, binding)
    if (windowBlocked) return { ok: false, block: windowBlocked }
    return {
      ok: true,
      value: {
        anchored,
        binding,
        driver: InputGuard.pointerDriver(driver),
      },
    }
  }

  export async function interactive(
    action: "type" | "key" | "scroll",
    driver: Driver,
    allowFocusRecovery = false,
    coords?: { x: number; y: number },
  ): Promise<
    Result<{
      selected: ReturnType<typeof resolveInputDriver>
    }>
  > {
    const verifyBlocked = verificationBlock(action, coords)
    if (verifyBlocked) return { ok: false, block: verifyBlocked }
    let selected: ReturnType<typeof resolveInputDriver>
    try {
      selected = resolveInputDriver(driver)
    } catch (error) {
      return {
        ok: false,
        block: InputGuard.driverUnavailable(action, driver, error),
      }
    }
    if (selected === "desktop") {
      const backendBlocked = capabilityBlock(action)
      if (backendBlocked) return { ok: false, block: backendBlocked }
      const windowBlocked = await InputGuard.ensureBoundWindowForeground(action, allowFocusRecovery)
      if (windowBlocked) return { ok: false, block: windowBlocked }
    }
    return {
      ok: true,
      value: { selected },
    }
  }
}
