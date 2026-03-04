import { Coordinates } from "../opencorvus/gui/coordinates"
import { DesktopState } from "./desktop-state"
import { WindowManager } from "../opencorvus/perception/window"
import { showOverlay, showWindowHighlight } from "./overlay-client"

export namespace InputGuard {
  export type Action = "click" | "type" | "key" | "scroll" | "drag" | "move"
  export type Driver = "auto" | "desktop" | "playwright" | "appium" | undefined

  export interface Block {
    title: string
    output: string
    metadata: Record<string, unknown>
  }

  export function pointerDriver(driver: Driver) {
    return "desktop" as const
  }

  export function pointerDriverBlock(action: "click" | "drag" | "move", driver: Driver): Block | null {
    if (!driver || driver === "auto" || driver === "desktop") return null
    showOverlay(undefined, undefined, action, `blocked: driver=${driver} unsupported`, "error")
    return {
      title: `Pointer action blocked: driver ${driver} unsupported`,
      output:
        `Action "${action}" requires desktop coordinate input and does not run on ${driver} driver. ` +
        `Use input with driver=desktop (or auto), or use selector-based automation flow for ${driver}.`,
      metadata: {
        blocked: true,
        reason: "pointer_driver_unsupported",
        action,
        driver,
      },
    }
  }

  export function driverUnavailable(action: "type" | "key" | "scroll", driver: Driver, error: unknown): Block {
    const reason = error instanceof Error ? error.message : String(error)
    showOverlay(undefined, undefined, action, `blocked: driver unavailable (${driver ?? "auto"})`, "error")
    return {
      title: `Action blocked: automation driver unavailable`,
      output: `Unable to resolve driver "${driver ?? "auto"}" for ${action}: ${reason}`,
      metadata: {
        blocked: true,
        reason: "driver_unavailable",
        action,
        driver: driver ?? "auto",
        detail: reason,
      },
    }
  }

  export function requireBounds(action: "click" | "drag" | "move"): Coordinates.WindowBounds | Block {
    const bounds = DesktopState.getBounds()
    if (bounds) return bounds
    showOverlay(undefined, undefined, action, "blocked: screenshot anchor required", "error")
    return {
      title: "Pointer action blocked: no coordinate anchor",
      output:
        "Cannot run pointer action without a recent screenshot anchor. " +
        "Take screen.screenshot first so coordinates are bound to one target (window or single monitor), then retry.",
      metadata: { blocked: true, reason: "no_bounds" },
    }
  }

  export function ensureWindowAnchor(
    action: "click" | "drag" | "move",
    anchored: Coordinates.WindowBounds,
    binding: Awaited<ReturnType<typeof WindowManager.getBinding>>,
  ): Block | null {
    const target = DesktopState.getTarget()
    if (target?.scope !== "window") return null
    if (!binding || (typeof target.windowId === "number" && binding.windowId !== target.windowId)) {
      showOverlay(undefined, undefined, action, "blocked: stale window anchor", "error")
      return {
        title: "Pointer action blocked: stale window anchor",
        output:
          "The previous screenshot anchor belongs to a window binding that is no longer active. " +
          "Re-bind with screen.bind_window and take a fresh screen.screenshot before retrying pointer actions.",
        metadata: {
          blocked: true,
          reason: "stale_window_anchor",
          expectedWindowId: target.windowId ?? null,
          expectedTitle: target.title ?? null,
          actualWindowId: binding?.windowId ?? null,
        },
      }
    }
    const sx = typeof anchored.scaleX === "number" && anchored.scaleX > 0 ? anchored.scaleX : 1
    const sy = typeof anchored.scaleY === "number" && anchored.scaleY > 0 ? anchored.scaleY : 1
    const expected = {
      x: typeof anchored.logicalX === "number" ? anchored.logicalX : Math.round(anchored.x / sx),
      y: typeof anchored.logicalY === "number" ? anchored.logicalY : Math.round(anchored.y / sy),
      width: typeof anchored.logicalWidth === "number" ? anchored.logicalWidth : Math.round(anchored.width / sx),
      height: typeof anchored.logicalHeight === "number" ? anchored.logicalHeight : Math.round(anchored.height / sy),
    }
    const actual = {
      x: binding.info.x,
      y: binding.info.y,
      width: binding.info.width,
      height: binding.info.height,
    }
    const complete =
      Number.isFinite(actual.x) &&
      Number.isFinite(actual.y) &&
      Number.isFinite(actual.width) &&
      Number.isFinite(actual.height)
    if (!complete) return null
    const drifted =
      Math.abs(expected.x - actual.x) > 2 ||
      Math.abs(expected.y - actual.y) > 2 ||
      Math.abs(expected.width - actual.width) > 2 ||
      Math.abs(expected.height - actual.height) > 2
    if (!drifted) return null
    showOverlay(undefined, undefined, action, "blocked: window geometry drifted", "error")
    return {
      title: "Pointer action blocked: window geometry drifted",
      output:
        "The bound window moved or resized since the last screenshot anchor. " +
        "Take a fresh screen.screenshot before retrying pointer actions so coordinates map to the current window geometry.",
      metadata: {
        blocked: true,
        reason: "window_geometry_drifted",
        expectedWindowId: target.windowId ?? null,
        expectedTitle: target.title ?? null,
        actualWindowId: binding.windowId,
        expectedBounds: expected,
        actualBounds: actual,
      },
    }
  }

  export async function ensureBoundWindowForeground(
    action: Action,
    allowFocusRecovery = false,
    bindingHint?: Awaited<ReturnType<typeof WindowManager.getBinding>>,
  ): Promise<Block | null> {
    const binding = bindingHint ?? (await WindowManager.getBinding())
    const target = DesktopState.getTarget()
    if (target?.scope === "monitor") return null
    if (!binding) {
      if (target?.scope !== "window") return null
      showOverlay(undefined, undefined, action, "blocked: stale window binding", "error")
      return {
        title: "Action blocked: stale window binding",
        output: "The previously bound window is no longer active. Re-bind with screen.bind_window and retry.",
        metadata: {
          blocked: true,
          reason: "stale_window_binding",
          expectedWindowId: target.windowId ?? null,
          expectedTitle: target.title ?? null,
        },
      }
    }
    if (target?.scope === "window" && typeof target.windowId === "number" && binding.windowId !== target.windowId) {
      showOverlay(undefined, undefined, action, "blocked: window binding drifted", "error")
      return {
        title: "Action blocked: window binding drifted",
        output:
          "Current window binding drifted from the screenshot anchor. " +
          "Re-bind with screen.bind_window and take a fresh screen.screenshot.",
        metadata: {
          blocked: true,
          reason: "window_binding_drifted",
          expectedWindowId: target.windowId,
          actualWindowId: binding.windowId,
        },
      }
    }
    const ok = await WindowManager.ensureBoundForeground(binding)
    if (ok) {
      showWindowHighlight({
        x: binding.info.x,
        y: binding.info.y,
        width: binding.info.width,
        height: binding.info.height,
        label: binding.info.title,
        durationMs: 1200,
      })
      return null
    }
    if (allowFocusRecovery) {
      showOverlay(undefined, undefined, action, "allowing focus recovery key", "running")
      return null
    }
    showOverlay(undefined, undefined, action, "blocked: bound window not foreground", "error")
    return {
      title: "Action blocked: bound window not foreground",
      output:
        "The bound window is not in foreground (possibly occluded or minimized). " +
        "Re-bind with screen.bind_window before retrying. " +
        "If your action uses coordinates, take a fresh screen.screenshot after re-bind.",
      metadata: {
        blocked: true,
        reason: "bound_window_not_foreground",
        title: binding.info.title,
        appName: binding.info.appName,
      },
    }
  }
}
