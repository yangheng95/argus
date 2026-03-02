import z from "zod"
import { Tool } from "./tool"
import { GUI } from "../opencorvus/gui/index"
import { Coordinates } from "../opencorvus/gui/coordinates"
import { DesktopState } from "./desktop-state"
import { GuiState } from "./gui-state"
import { WindowManager } from "../opencorvus/perception/window"
import { Log } from "../util/log"
import { overlayDiagnostic, requestOverlayConfirm, showOverlay, showWindowHighlight } from "./overlay-client"

const log = Log.create({ service: "input" })

function coordinateSpace(): Coordinates.CoordinateSpace {
  const value = process.env.OPENCORVUS_COORDINATE_SPACE?.toLowerCase()
  if (value === "physical" || value === "logical") return value
  // Default to "logical": screenshots are captured at physical-pixel resolution
  // but nut.js operates in OS/logical coordinates (DPI-scaled).
  // On 1:1 displays the two spaces are identical, but on HiDPI displays
  // "physical" sends oversized coordinates that land off-screen.
  return "logical"
}

const DESCRIPTION = `Interact with the desktop environment. Use this tool to click, type text, press keys, scroll, drag, move mouse, wait, and request desktop confirmation.

Actions:
- click: Click at (x, y) coordinates. Button: "left" (default), "right", "double", "middle".
- type: Type text by pasting from clipboard (more reliable than keystroke simulation).
- key: Press a key or combination (e.g. "enter", "ctrl+c", "alt+f4", "win", "ctrl+shift+s").
- scroll: Scroll up or down at the current mouse position.
- drag: Drag from (startX, startY) to (endX, endY).
- move: Move mouse to (x, y) without clicking. Useful for hover effects.
- wait: Wait for a specified number of milliseconds. Use between actions when UI needs time to load.
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
- Use wait after opening apps or loading pages to let UI settle.`

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
  ms: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(100).max(10000).default(1000)).describe("Milliseconds to wait (100-10000)"),
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
    const lastWindowBounds = DesktopState.getBounds()
    const space = coordinateSpace()

    const requireBounds = () => {
      if (lastWindowBounds) return null
      return {
        title: "Pointer action blocked: no coordinate anchor",
        output: "Cannot run pointer action without a recent screenshot anchor. Take screen.screenshot first so coordinates are bound to one target (window or single monitor), then retry.",
        metadata: { blocked: true, reason: "no_bounds" },
      }
    }

    const ensureBoundWindowForeground = async () => {
      const binding = await WindowManager.getBinding()
      if (!binding) return null
      const ok = await WindowManager.ensureBoundForeground()
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
        const blocked = requireBounds()
        if (blocked) return blocked
        const windowBlocked = await ensureBoundWindowForeground()
        if (windowBlocked) return windowBlocked
        const screen = Coordinates.resolveDetailed(params.x, params.y, lastWindowBounds, space)
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
          bounds: lastWindowBounds
            ? `${lastWindowBounds.width}x${lastWindowBounds.height}@${lastWindowBounds.x},${lastWindowBounds.y}`
            : "none",
          coordinateSpace: space,
          button: params.button ?? "left",
          clamped: screen.clamped,
        })
        if (screen.clamped && lastWindowBounds) {
          log.warn("click-coordinate-clamped", {
            requested: `${params.x},${params.y}`,
            clampedTo: `${screen.x},${screen.y}`,
            bounds: `${lastWindowBounds.width}x${lastWindowBounds.height}`,
          })
        }
        if (params.button === "double") {
          await GUI.doubleClick(screen.x, screen.y)
        } else if (params.button === "right") {
          await GUI.rightClick(screen.x, screen.y)
        } else if (params.button === "middle") {
          await GUI.middleClick(screen.x, screen.y)
        } else {
          await GUI.click(screen.x, screen.y)
        }
        showOverlay(screen.x, screen.y, action, "done", "done")
        const coordDetail = lastWindowBounds
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
          metadata: { x: params.x, y: params.y, screenX: screen.x, screenY: screen.y, button: params.button, clamped: screen.clamped, clampedX: screen.clampedX, clampedY: screen.clampedY, coordinateSpace: space },
        }
      }

      case "type": {
        const windowBlocked = await ensureBoundWindowForeground()
        if (windowBlocked) return windowBlocked
        showOverlay(0, 0, "type", params.text.length > 20 ? params.text.slice(0, 20) : params.text)
        await GUI.paste(params.text)
        showOverlay(0, 0, "type", `done ${params.text.length} chars`, "done")
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
        const windowBlocked = await ensureBoundWindowForeground()
        if (windowBlocked) return windowBlocked
        showOverlay(0, 0, "key", params.key)
        const parts = params.key.split("+").map((k) => k.trim())
        if (parts.length > 1) {
          await GUI.hotkey(...parts)
        } else {
          await GUI.pressKey(parts[0])
        }
        showOverlay(0, 0, "key", `done ${params.key}`, "done")
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
        const windowBlocked = await ensureBoundWindowForeground()
        if (windowBlocked) return windowBlocked
        showOverlay(0, 0, "scroll", `${params.direction} ${params.amount}`)
        await GUI.scroll(params.direction, params.amount)
        showOverlay(0, 0, "scroll", `done ${params.direction}`, "done")
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
        const blocked = requireBounds()
        if (blocked) return blocked
        const windowBlocked = await ensureBoundWindowForeground()
        if (windowBlocked) return windowBlocked
        const start = Coordinates.resolveDetailed(params.startX, params.startY, lastWindowBounds, space)
        const end = Coordinates.resolveDetailed(params.endX, params.endY, lastWindowBounds, space)
        showOverlay(start.x, start.y, "drag", `→(${params.endX},${params.endY})`)
        await GUI.drag(start.x, start.y, end.x, end.y)
        showOverlay(end.x, end.y, "drag", "done", "done")
        const coordDetail = lastWindowBounds
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
            coordinateSpace: space,
          },
        }
      }

      case "move": {
        const blocked = requireBounds()
        if (blocked) return blocked
        const windowBlocked = await ensureBoundWindowForeground()
        if (windowBlocked) return windowBlocked
        const screen = Coordinates.resolveDetailed(params.x, params.y, lastWindowBounds, space)
        showOverlay(screen.x, screen.y, "move", `(${params.x},${params.y})`)
        await GUI.moveTo(screen.x, screen.y)
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
          metadata: { x: params.x, y: params.y, screenX: screen.x, screenY: screen.y, clamped: screen.clamped, clampedX: screen.clampedX, clampedY: screen.clampedY, coordinateSpace: space },
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
        GuiState.recordAction({
          time: Date.now(),
          tool: "input",
          action: "confirm",
          detail: `${params.title} => ${answer}`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        if (unavailable) {
          log.warn("overlay-confirm-unavailable", {
            reason: unavailableReason,
            path: overlay.path,
          })
        }
        return {
          title: accepted ? "User confirmed" : unavailable ? "Desktop confirm unavailable" : "User did not confirm",
          output: unavailable
            ? `Desktop confirmation window is unavailable (${unavailableReason}). Continue with a fallback flow (question tool or safe default).`
            : accepted
              ? "User confirmed to continue with the next step."
              : answer === "timeout"
                ? "Confirmation timed out. Treat as not confirmed and ask a follow-up if needed."
                : "User cancelled the next step.",
          metadata: { answer, confirmed: accepted, timeout: answer === "timeout", unavailable, unavailableReason },
        }
      }
    }
  },
})
