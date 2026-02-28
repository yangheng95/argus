import z from "zod"
import { Tool } from "./tool"
import { GUI } from "../argus/gui/index"
import { Capture } from "../argus/perception/capture"

const DESCRIPTION = `Interact with the desktop environment. Use this tool to take screenshots, click, type text, press keys, and scroll.

Actions:
- screenshot: Capture the current screen. Returns the image for visual analysis.
- click: Click at (x, y) coordinates on screen.
- type: Type text by pasting from clipboard (more reliable than keystroke simulation).
- key: Press a key or key combination (e.g. "Enter", "ctrl+c", "alt+tab").
- scroll: Scroll up or down at the current mouse position.

Best practices:
- Always take a screenshot first to observe the current state before interacting.
- After performing an action, take another screenshot to verify the result.
- Use click to position the cursor before typing or scrolling.`

const ScreenshotAction = z.object({
  action: z.literal("screenshot"),
})

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

const ComputerParams = z.discriminatedUnion("action", [
  ScreenshotAction,
  ClickAction,
  TypeAction,
  KeyAction,
  ScrollAction,
])

export const ComputerTool = Tool.define("computer", {
  description: DESCRIPTION,
  parameters: ComputerParams,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any>; attachments?: { type: "file"; mime: string; url: string }[] }> {
    await ctx.ask({
      permission: "computer",
      patterns: [params.action],
      always: ["*"],
      metadata: { action: params.action },
    })

    switch (params.action) {
      case "screenshot": {
        const result = await Capture.take({ mode: "fullscreen" })
        const base64 = result.buffer.toString("base64")
        return {
          title: `Screenshot captured (${result.width}x${result.height})`,
          output: `Screenshot captured: ${result.width}x${result.height} pixels`,
          metadata: { width: result.width, height: result.height },
          attachments: [
            {
              type: "file" as const,
              mime: "image/png",
              url: `data:image/png;base64,${base64}`,
            },
          ],
        }
      }

      case "click": {
        if (params.button === "double") {
          await GUI.doubleClick(params.x, params.y)
        } else if (params.button === "right") {
          await GUI.rightClick(params.x, params.y)
        } else {
          await GUI.click(params.x, params.y)
        }
        return {
          title: `Clicked (${params.x}, ${params.y})`,
          output: `${params.button ?? "left"} click at (${params.x}, ${params.y})`,
          metadata: { x: params.x, y: params.y, button: params.button },
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
    }
  },
})
