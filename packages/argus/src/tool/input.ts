import z from "zod"
import { Tool } from "./tool"
import { GUI } from "../argus/gui/index"
import { Coordinates } from "../argus/gui/coordinates"
import { DesktopState } from "./desktop-state"

const DESCRIPTION = `Interact with the desktop environment. Use this tool to click, type text, press keys, scroll, and drag.

Actions:
- click: Click at (x, y) coordinates. If a window is bound, coordinates are relative to that window.
- type: Type text by pasting from clipboard (more reliable than keystroke simulation).
- key: Press a key or key combination (e.g. "Enter", "ctrl+c", "alt+tab").
- scroll: Scroll up or down at the current mouse position.
- drag: Drag from (startX, startY) to (endX, endY). If a window is bound, coordinates are relative to that window.

Best practices:
- Always take a screenshot with the screen tool first to observe the current state before interacting.
- After performing an action, take another screenshot to verify the result.
- When a window is bound via the screen tool, all coordinates are relative to that window.
- Use click to position the cursor before typing or scrolling.`

const ClickAction = z.object({
  action: z.literal("click"),
  x: z.number().describe("X coordinate to click"),
  y: z.number().describe("Y coordinate to click"),
  button: z.enum(["left", "right", "double"]).default("left").describe("Mouse button or double-click"),
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
  amount: z.number().default(3).describe("Number of scroll steps"),
})

const DragAction = z.object({
  action: z.literal("drag"),
  startX: z.number().describe("Start X coordinate"),
  startY: z.number().describe("Start Y coordinate"),
  endX: z.number().describe("End X coordinate"),
  endY: z.number().describe("End Y coordinate"),
})

const InputParams = z.discriminatedUnion("action", [
  ClickAction,
  TypeAction,
  KeyAction,
  ScrollAction,
  DragAction,
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
    }
  },
})
