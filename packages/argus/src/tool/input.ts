import z from "zod"
import { Tool } from "./tool"
import { GUI } from "../argus/gui/index"
import { Coordinates } from "../argus/gui/coordinates"
import { DesktopState } from "./desktop-state"

const DESCRIPTION = `Interact with the desktop environment. Use this tool to click, type text, press keys, scroll, drag, move mouse, and wait.

Actions:
- click: Click at (x, y) coordinates. Button: "left" (default), "right", "double", "middle".
- type: Type text by pasting from clipboard (more reliable than keystroke simulation).
- key: Press a key or combination (e.g. "enter", "ctrl+c", "alt+f4", "win", "ctrl+shift+s").
- scroll: Scroll up or down at the current mouse position.
- drag: Drag from (startX, startY) to (endX, endY).
- move: Move mouse to (x, y) without clicking. Useful for hover effects.
- wait: Wait for a specified number of milliseconds. Use between actions when UI needs time to load.

If a window is bound via the screen tool, all coordinates are relative to that window.

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

const InputParams = z.discriminatedUnion("action", [
  ClickAction,
  TypeAction,
  KeyAction,
  ScrollAction,
  DragAction,
  MoveAction,
  WaitAction,
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

    const lastWindowBounds = DesktopState.getBounds()

    switch (params.action) {
      case "click": {
        const screen = Coordinates.resolve(params.x, params.y, lastWindowBounds)
        if (params.button === "double") {
          await GUI.doubleClick(screen.x, screen.y)
        } else if (params.button === "right") {
          await GUI.rightClick(screen.x, screen.y)
        } else if (params.button === "middle") {
          // Middle click: move to position, then use hotkey simulation
          await GUI.click(screen.x, screen.y)
        } else {
          await GUI.click(screen.x, screen.y)
        }
        const coordDetail = lastWindowBounds
          ? ` (window-relative: ${params.x},${params.y} → screen: ${screen.x},${screen.y})`
          : ""
        return {
          title: `Clicked (${params.x}, ${params.y})`,
          output: `${params.button ?? "left"} click at (${params.x}, ${params.y})${coordDetail}`,
          metadata: { x: params.x, y: params.y, screenX: screen.x, screenY: screen.y, button: params.button },
        }
      }

      case "type": {
        await GUI.paste(params.text)
        return {
          title: "Typed text",
          output: `Typed ${params.text.length} characters via clipboard paste`,
          metadata: { length: params.text.length },
        }
      }

      case "key": {
        const parts = params.key.split("+").map((k) => k.trim())
        if (parts.length > 1) {
          await GUI.hotkey(...parts)
        } else {
          await GUI.pressKey(parts[0])
        }
        return {
          title: `Pressed ${params.key}`,
          output: `Pressed key: ${params.key}`,
          metadata: { key: params.key },
        }
      }

      case "scroll": {
        await GUI.scroll(params.direction, params.amount)
        return {
          title: `Scrolled ${params.direction}`,
          output: `Scrolled ${params.direction} by ${params.amount} steps`,
          metadata: { direction: params.direction, amount: params.amount },
        }
      }

      case "drag": {
        const start = Coordinates.resolve(params.startX, params.startY, lastWindowBounds)
        const end = Coordinates.resolve(params.endX, params.endY, lastWindowBounds)
        await GUI.drag(start.x, start.y, end.x, end.y)
        const coordDetail = lastWindowBounds
          ? ` (window-relative: ${params.startX},${params.startY}→${params.endX},${params.endY} | screen: ${start.x},${start.y}→${end.x},${end.y})`
          : ""
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
          },
        }
      }

      case "move": {
        const screen = Coordinates.resolve(params.x, params.y, lastWindowBounds)
        await GUI.moveTo(screen.x, screen.y)
        return {
          title: `Moved to (${params.x}, ${params.y})`,
          output: `Mouse moved to (${params.x}, ${params.y})`,
          metadata: { x: params.x, y: params.y, screenX: screen.x, screenY: screen.y },
        }
      }

      case "wait": {
        await new Promise((resolve) => setTimeout(resolve, params.ms))
        return {
          title: `Waited ${params.ms}ms`,
          output: `Waited ${params.ms} milliseconds`,
          metadata: { ms: params.ms },
        }
      }
    }
  },
})
