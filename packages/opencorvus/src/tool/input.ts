import z from "zod"
import { Tool } from "./tool"
import { GUI } from "../opencorvus/gui/index"
import { Coordinates } from "../opencorvus/gui/coordinates"
import { DesktopState } from "./desktop-state"
import { GuiState } from "./gui-state"
import { WindowManager } from "../opencorvus/perception/window"
import { Log } from "../util/log"
import { overlayDiagnostic, requestOverlayConfirm, showOverlay, showWindowHighlight } from "./overlay-client"
import { Capability } from "../platform/capability"
import { runInputAction } from "./input-action-engine"

const log = Log.create({ service: "input" })

function coordinateSpace(): Coordinates.CoordinateSpace {
  const value = process.env.OPENCORVUS_COORDINATE_SPACE?.toLowerCase()
  if (value === "physical" || value === "logical" || value === "auto") return value
  return "auto"
}

function split(input: string) {
  return input
    .split("+")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
}

function focusKey(key: string) {
  const parts = split(key)
  if (!parts.includes("tab")) return false
  return parts.some((part) => part === "alt" || part === "cmd" || part === "command" || part === "meta" || part === "super" || part === "win" || part === "windows")
}

const DESCRIPTION = `Interact with the desktop environment. Use this tool to click, type text, press keys, scroll, drag, move mouse, wait, and request desktop confirmation.

Actions:
- click: Click at (x, y) coordinates. Button: "left" (default), "right", "double", "middle".
- type: Type text by pasting from clipboard (more reliable than keystroke simulation).
- key: Press a key or combination (e.g. "enter", "ctrl+c", "alt+f4", "win", "ctrl+shift+s").
- scroll: Scroll up or down at the current mouse position.
- drag: Drag from (startX, startY) to (endX, endY).
- move: Move mouse to (x, y) without clicking. Useful for hover effects.
- wait: Wait for a short pause in milliseconds. Prefer skipping it; when needed, start with 10ms.
- confirm: Open a desktop confirmation dialog and wait for user choice before continuing.

If a window is bound via the screen tool, all coordinates are relative to that window.
Pointer actions (click/drag/move) require a recent screen.screenshot anchor. If no anchor exists, they are blocked.

Key names (case-insensitive): enter, esc, tab, space, backspace, delete, insert,
  ctrl, alt, shift, win/super/meta/cmd, f1-f24, a-z, 0-9,
  up/down/left/right, home, end, pageup, pagedown, capslock, printscreen, pause.
Combinations: use "+" separator, e.g. "ctrl+c", "alt+f4", "ctrl+shift+s", "win+e".

IMPORTANT: All coordinate parameters (x, y, startX, startY, endX, endY) must be single integer values, NOT arrays.
  Correct: {"x": 500, "y": 300}
  Wrong:   {"x": [500, 300]} or {"x": "[500]"}

Best practices:
- Always take a screenshot BEFORE interacting to see current state.
- After performing an action, take another screenshot to VERIFY the result.
- Click on a text field BEFORE typing to ensure it has focus.
- Avoid long waits; prefer 10ms wait + screenshot verification loop, or use screen.screenshot wait_for_change.`

// Robust number parser: handles any format LLMs might produce.
// Examples: 500, "500", "[500]", "[500, 300]", "([714, 584],)", "(500)", etc. → first integer
const coord = z.preprocess((val) => {
  if (typeof val === "number") return Math.round(val)
  if (typeof val === "string") {
    // Extract the first number from any string format
    const match = val.match(/-?\d+/)
    if (match) return Number(match[0])
    return undefined
  }
  if (Array.isArray(val)) {
    // [500] or [500, 300] → first element
    const first = val[0]
    return typeof first === "number" ? Math.round(first) : Number(first)
  }
  return undefined
}, z.number().int())

const ClickAction = z.object({
  action: z.literal("click"),
  x: coord.describe("X coordinate to click"),
  y: coord.describe("Y coordinate to click"),
  button: z.enum(["left", "right", "double", "middle"]).default("left").describe("Mouse button: left, right, double, or middle"),
})

const TypeAction = z.object({
  action: z.literal("type"),
  text: z.string().describe("Text to type (pasted via clipboard for reliability)"),
})

const KeyAction = z.object({
  action: z.literal("key"),
  key: z.string().describe('Key or combination to press (e.g. "Enter", "ctrl+c", "alt+tab")'),
})

const ScrollAction = z.object({
  action: z.literal("scroll"),
  direction: z.enum(["up", "down"]).describe("Scroll direction"),
  amount: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().default(3)).describe("Number of scroll steps"),
})

const DragAction = z.object({
  action: z.literal("drag"),
  startX: coord.describe("Start X coordinate"),
  startY: coord.describe("Start Y coordinate"),
  endX: coord.describe("End X coordinate"),
  endY: coord.describe("End Y coordinate"),
})

const MoveAction = z.object({
  action: z.literal("move"),
  x: coord.describe("X coordinate to move to"),
  y: coord.describe("Y coordinate to move to"),
})

const WaitAction = z.object({
  action: z.literal("wait"),
  ms: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(10).max(1000).default(10)).describe("Milliseconds to wait (10-1000, default 10)"),
})

const ConfirmAction = z.object({
  action: z.literal("confirm"),
  title: z.string().min(1).max(120).describe("Dialog title"),
  message: z.string().min(1).max(1000).describe("Dialog body text"),
  confirm: z.string().min(1).max(30).default("Confirm").describe("Confirm button label"),
  cancel: z.string().min(1).max(30).default("Cancel").describe("Cancel button label"),
  timeoutMs: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(1000).max(120000).default(30000)).describe("Dialog timeout in milliseconds"),
})

const InputParams = z.discriminatedUnion("action", [
  ClickAction,
  TypeAction,
  KeyAction,
  ScrollAction,
  DragAction,
  MoveAction,
  WaitAction,
  ConfirmAction,
])

export const InputTool = Tool.define("input", {
  description: DESCRIPTION,
  parameters: InputParams,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any> }> {
    await ctx.ask({
      permission: "input",
      patterns: [params.action],
      always: ["*"],
      metadata: { action: params.action },
    })

    GuiState.activate()
    DesktopState.markTask(GuiState.get().taskEpoch)
    await WindowManager.rebindForTask(GuiState.get().taskEpoch)
    const space = coordinateSpace()

    const requireBounds = async (
      action: "click" | "drag" | "move",
    ): Promise<Coordinates.WindowBounds | { title: string; output: string; metadata: Record<string, any> }> => {
      const bounds = DesktopState.getBounds()
      if (bounds) return bounds
      showOverlay(undefined, undefined, action, "blocked: screenshot anchor required", "error")
      return {
        title: "Pointer action blocked: no coordinate anchor",
        output: "Cannot run pointer action without a recent screenshot anchor. Take screen.screenshot first so coordinates are bound to one target (window or single monitor), then retry.",
        metadata: { blocked: true, reason: "no_bounds" },
      }
    }

    const ensureWindowAnchor = async (
      action: "click" | "drag" | "move",
      anchored: Coordinates.WindowBounds,
      binding: Awaited<ReturnType<typeof WindowManager.getBinding>>,
    ) => {
      const target = DesktopState.getTarget()
      if (target?.scope !== "window") return null
      if (!binding || (typeof target.windowId === "number" && binding.windowId !== target.windowId)) {
        showOverlay(undefined, undefined, action, "blocked: stale window anchor", "error")
        return {
          title: "Pointer action blocked: stale window anchor",
          output:
            "The previous screenshot anchor belongs to a window binding that is no longer active. Re-bind with screen.bind_window and take a fresh screen.screenshot before retrying pointer actions.",
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
      const complete = Number.isFinite(actual.x) && Number.isFinite(actual.y) && Number.isFinite(actual.width) && Number.isFinite(actual.height)
      if (!complete) return null
      const drifted = Math.abs(expected.x - actual.x) > 2
        || Math.abs(expected.y - actual.y) > 2
        || Math.abs(expected.width - actual.width) > 2
        || Math.abs(expected.height - actual.height) > 2
      if (!drifted) return null
      showOverlay(undefined, undefined, action, "blocked: window geometry drifted", "error")
      return {
        title: "Pointer action blocked: window geometry drifted",
        output:
          "The bound window moved or resized since the last screenshot anchor. Take a fresh screen.screenshot before retrying pointer actions so coordinates map to the current window geometry.",
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

    const ensureBoundWindowForeground = async (
      action: "click" | "type" | "key" | "scroll" | "drag" | "move",
      allowFocusRecovery = false,
      bindingHint?: Awaited<ReturnType<typeof WindowManager.getBinding>>,
    ) => {
      const binding = bindingHint ?? await WindowManager.getBinding()
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
          output: "Current window binding drifted from the screenshot anchor. Re-bind with screen.bind_window and take a fresh screen.screenshot.",
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
          "The bound window is not in foreground (possibly occluded or minimized). Re-bind with screen.bind_window before retrying. If your action uses coordinates, take a fresh screen.screenshot after re-bind.",
        metadata: {
          blocked: true,
          reason: "bound_window_not_foreground",
          title: binding.info.title,
          appName: binding.info.appName,
        },
      }
    }

    switch (params.action) {
      case "click": {
        const anchored = await requireBounds("click")
        if ("title" in anchored) return anchored
        const binding = await WindowManager.getBinding()
        const anchorBlocked = await ensureWindowAnchor("click", anchored, binding)
        if (anchorBlocked) return anchorBlocked
        const windowBlocked = await ensureBoundWindowForeground("click", false, binding)
        if (windowBlocked) return windowBlocked
        const resolvedSpace = Coordinates.resolveSpace(params.x, params.y, anchored, space)
        const screen = Coordinates.resolveDetailed(params.x, params.y, anchored, space)
        const action = params.button === "double" ? "double" : params.button === "right" ? "right" : params.button === "middle" ? "middle" : "click"
        showOverlay(
          screen.x,
          screen.y,
          action,
          `${params.button ?? "left"} (${params.x},${params.y})`,
        )
        log.info("click-resolve", {
          windowRelative: `${params.x},${params.y}`,
          screenAbsolute: `${screen.x},${screen.y}`,
          bounds: anchored
            ? `${anchored.width}x${anchored.height}@${anchored.x},${anchored.y}`
            : "none",
          coordinateSpaceRequested: space,
          coordinateSpaceResolved: resolvedSpace,
          button: params.button ?? "left",
          clamped: screen.clamped,
        })
        if (screen.clamped) {
          log.warn("click-coordinate-clamped", {
            requested: `${params.x},${params.y}`,
            clampedTo: `${screen.x},${screen.y}`,
            bounds: `${anchored.width}x${anchored.height}`,
          })
        }
        const clickResult = await runInputAction({
          id: `input.click.${params.button ?? "left"}`,
          abort: ctx.abort,
          action: async () => {
            if (params.button === "double") return GUI.doubleClick(screen.x, screen.y)
            if (params.button === "right") return GUI.rightClick(screen.x, screen.y)
            if (params.button === "middle") return GUI.middleClick(screen.x, screen.y)
            return GUI.click(screen.x, screen.y)
          },
        })
        if (clickResult.tries > 1) {
          log.warn("input-action-retried", {
            action: `click.${params.button ?? "left"}`,
            tries: clickResult.tries,
            x: screen.x,
            y: screen.y,
          })
        }
        showOverlay(screen.x, screen.y, action, "done", "done")
        const coordDetail = anchored
          ? ` (window-relative: ${params.x},${params.y} → screen: ${screen.x},${screen.y}${screen.clamped ? " [CLAMPED]" : ""})`
          : ""
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "click",
          coords: { x: params.x, y: params.y },
          detail: params.button ?? "left",
          screenshotHashAfter: null,
          screenChanged: null,
        })
        GuiState.updateRepetition(null, { x: params.x, y: params.y })
        return {
          title: `Clicked (${params.x}, ${params.y})`,
          output: `${params.button ?? "left"} click at (${params.x}, ${params.y})${coordDetail}`,
          metadata: { x: params.x, y: params.y, screenX: screen.x, screenY: screen.y, button: params.button, clamped: screen.clamped, clampedX: screen.clampedX, clampedY: screen.clampedY, coordinateSpaceRequested: space, coordinateSpace: resolvedSpace },
        }
      }

      case "type": {
        const windowBlocked = await ensureBoundWindowForeground("type")
        if (windowBlocked) return windowBlocked
        showOverlay(undefined, undefined, "type", params.text.length > 20 ? params.text.slice(0, 20) : params.text)
        const typeResult = await runInputAction({
          id: "input.type",
          abort: ctx.abort,
          action: () => GUI.paste(params.text),
        })
        if (typeResult.tries > 1) {
          log.warn("input-action-retried", {
            action: "type",
            tries: typeResult.tries,
            length: params.text.length,
          })
        }
        showOverlay(undefined, undefined, "type", `done ${params.text.length} chars`, "done")
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "type",
          detail: `"${params.text.length > 40 ? params.text.slice(0, 37) + "..." : params.text}"`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        return {
          title: "Typed text",
          output: `Typed ${params.text.length} characters via clipboard paste`,
          metadata: { length: params.text.length },
        }
      }

      case "key": {
        const windowBlocked = await ensureBoundWindowForeground("key", focusKey(params.key))
        if (windowBlocked) return windowBlocked
        showOverlay(undefined, undefined, "key", params.key)
        const parts = params.key.split("+").map((k) => k.trim())
        const keyResult = await runInputAction({
          id: parts.length > 1 ? "input.key.hotkey" : "input.key.single",
          abort: ctx.abort,
          action: () => {
            if (parts.length > 1) return GUI.hotkey(...parts)
            return GUI.pressKey(parts[0])
          },
        })
        if (keyResult.tries > 1) {
          log.warn("input-action-retried", {
            action: parts.length > 1 ? "key.hotkey" : "key.single",
            tries: keyResult.tries,
            key: params.key,
          })
        }
        showOverlay(undefined, undefined, "key", `done ${params.key}`, "done")
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "key",
          detail: params.key,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        return {
          title: `Pressed ${params.key}`,
          output: `Pressed key: ${params.key}`,
          metadata: { key: params.key },
        }
      }

      case "scroll": {
        const windowBlocked = await ensureBoundWindowForeground("scroll")
        if (windowBlocked) return windowBlocked
        showOverlay(undefined, undefined, "scroll", `${params.direction} ${params.amount}`)
        const scrollResult = await runInputAction({
          id: "input.scroll",
          abort: ctx.abort,
          action: () => GUI.scroll(params.direction, params.amount),
        })
        if (scrollResult.tries > 1) {
          log.warn("input-action-retried", {
            action: "scroll",
            tries: scrollResult.tries,
            direction: params.direction,
            amount: params.amount,
          })
        }
        showOverlay(undefined, undefined, "scroll", `done ${params.direction}`, "done")
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "scroll",
          detail: `${params.direction} ${params.amount}`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        return {
          title: `Scrolled ${params.direction}`,
          output: `Scrolled ${params.direction} by ${params.amount} steps`,
          metadata: { direction: params.direction, amount: params.amount },
        }
      }

      case "drag": {
        const anchored = await requireBounds("drag")
        if ("title" in anchored) return anchored
        const binding = await WindowManager.getBinding()
        const anchorBlocked = await ensureWindowAnchor("drag", anchored, binding)
        if (anchorBlocked) return anchorBlocked
        const windowBlocked = await ensureBoundWindowForeground("drag", false, binding)
        if (windowBlocked) return windowBlocked
        const resolvedSpace = Coordinates.resolveSpace(params.startX, params.startY, anchored, space)
        const start = Coordinates.resolveDetailed(params.startX, params.startY, anchored, space)
        const end = Coordinates.resolveDetailed(params.endX, params.endY, anchored, space)
        showOverlay(start.x, start.y, "drag", `→(${params.endX},${params.endY})`)
        const dragResult = await runInputAction({
          id: "input.drag",
          abort: ctx.abort,
          action: () => GUI.drag(start.x, start.y, end.x, end.y),
        })
        if (dragResult.tries > 1) {
          log.warn("input-action-retried", {
            action: "drag",
            tries: dragResult.tries,
            startX: start.x,
            startY: start.y,
            endX: end.x,
            endY: end.y,
          })
        }
        showOverlay(end.x, end.y, "drag", "done", "done")
        const coordDetail = anchored
          ? ` (window-relative: ${params.startX},${params.startY}→${params.endX},${params.endY} | screen: ${start.x},${start.y}→${end.x},${end.y}${start.clamped || end.clamped ? " [CLAMPED]" : ""})`
          : ""
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "drag",
          coords: { x: params.startX, y: params.startY },
          detail: `→(${params.endX},${params.endY})`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        return {
          title: `Dragged (${params.startX},${params.startY}) → (${params.endX},${params.endY})`,
          output: `Dragged from (${params.startX},${params.startY}) to (${params.endX},${params.endY})${coordDetail}`,
          metadata: {
            startX: params.startX,
            startY: params.startY,
            endX: params.endX,
            endY: params.endY,
            screenStartX: start.x,
            screenStartY: start.y,
            screenEndX: end.x,
            screenEndY: end.y,
            clampedStart: start.clamped,
            clampedEnd: end.clamped,
            coordinateSpaceRequested: space,
            coordinateSpace: resolvedSpace,
          },
        }
      }

      case "move": {
        const anchored = await requireBounds("move")
        if ("title" in anchored) return anchored
        const binding = await WindowManager.getBinding()
        const anchorBlocked = await ensureWindowAnchor("move", anchored, binding)
        if (anchorBlocked) return anchorBlocked
        const windowBlocked = await ensureBoundWindowForeground("move", false, binding)
        if (windowBlocked) return windowBlocked
        const resolvedSpace = Coordinates.resolveSpace(params.x, params.y, anchored, space)
        const screen = Coordinates.resolveDetailed(params.x, params.y, anchored, space)
        showOverlay(screen.x, screen.y, "move", `(${params.x},${params.y})`)
        const moveResult = await runInputAction({
          id: "input.move",
          abort: ctx.abort,
          action: () => GUI.moveTo(screen.x, screen.y),
        })
        if (moveResult.tries > 1) {
          log.warn("input-action-retried", {
            action: "move",
            tries: moveResult.tries,
            x: screen.x,
            y: screen.y,
          })
        }
        showOverlay(screen.x, screen.y, "move", "done", "done")
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "move",
          coords: { x: params.x, y: params.y },
          detail: "",
          screenshotHashAfter: null,
          screenChanged: null,
        })
        return {
          title: `Moved to (${params.x}, ${params.y})`,
          output: `Mouse moved to (${params.x}, ${params.y})${screen.clamped ? " [CLAMPED]" : ""}`,
          metadata: { x: params.x, y: params.y, screenX: screen.x, screenY: screen.y, clamped: screen.clamped, clampedX: screen.clampedX, clampedY: screen.clampedY, coordinateSpaceRequested: space, coordinateSpace: resolvedSpace },
        }
      }

      case "wait": {
        await new Promise((resolve) => setTimeout(resolve, params.ms))
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "wait",
          detail: `${params.ms}ms`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        return {
          title: `Waited ${params.ms}ms`,
          output: `Waited ${params.ms} milliseconds`,
          metadata: { ms: params.ms },
        }
      }

      case "confirm": {
        showOverlay(undefined, undefined, "confirm", params.title, "running")
        const answer = await requestOverlayConfirm({
          title: params.title,
          message: params.message,
          confirm: params.confirm,
          cancel: params.cancel,
          timeoutMs: params.timeoutMs,
        })
        const accepted = answer === "confirm"
        const unavailable = answer === "unavailable"
        const overlay = overlayDiagnostic()
        const unavailableReason = unavailable ? overlay.reason ?? "unknown" : undefined
        const capabilityHint = unavailable
          ? Capability.cachedItem("overlay_confirm")?.hint || Capability.overlayItem().hint
          : undefined
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "confirm",
          detail: `${params.title} => ${answer}`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        if (unavailable) {
          showOverlay(undefined, undefined, "confirm", `unavailable ${unavailableReason}`, "error")
          log.warn("overlay-confirm-unavailable", {
            reason: unavailableReason,
            path: overlay.path,
          })
        } else if (accepted) {
          showOverlay(undefined, undefined, "confirm", "confirmed", "done")
        } else if (answer === "timeout") {
          showOverlay(undefined, undefined, "confirm", "timeout", "error")
        } else {
          showOverlay(undefined, undefined, "confirm", "cancelled", "error")
        }
        return {
          title: accepted ? "User confirmed" : unavailable ? "Desktop confirm unavailable" : "User did not confirm",
          output: unavailable
            ? `Desktop confirmation window is unavailable (${unavailableReason}). Continue with a fallback flow (question tool or safe default).${capabilityHint ? ` Hint: ${capabilityHint}` : ""}`
            : accepted
              ? "User confirmed to continue with the next step."
              : answer === "timeout"
                ? "Confirmation timed out. Treat as not confirmed and ask a follow-up if needed."
                : "User cancelled the next step.",
          metadata: { answer, confirmed: accepted, timeout: answer === "timeout", unavailable, unavailableReason, capabilityHint },
        }
      }
    }
  },
})
