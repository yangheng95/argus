import z from "zod"
import { createHash } from "crypto"
import { Tool } from "./tool"
import { Capture } from "../argus/perception/capture"
import { WindowManager } from "../argus/perception/window"
import { DesktopState } from "./desktop-state"

const DESCRIPTION = `Observe the desktop environment. Use this tool to take screenshots, list windows, and bind to a specific window.

Actions:
- screenshot: Capture the current screen (or bound window). Returns the image for visual analysis. If the screen has not changed since the last screenshot, it will tell you instead of returning the image again (saves analysis time).
- list_windows: List all visible windows with their positions and sizes. Use this to find windows before interacting.
- bind_window: Bind to a specific window by title substring. After binding, screenshots capture only that window and coordinates become window-relative to it.

IMPORTANT workflow:
1. Use list_windows FIRST to see what apps are open and find the one you need.
2. Use bind_window to focus on the target app — this makes coordinates easier and screenshots cleaner.
3. Take a screenshot of the bound window to see its content.
4. Interact with the app via the input tool, using coordinates from the screenshot.
5. Take another screenshot to verify the result.

IMPORTANT: After viewing each screenshot, you MUST describe what you see in your text response (visible windows, UI elements, text, key coordinates). Screenshots are automatically removed from context after the current turn — only your text description persists.`

/** Track last screenshot hash to avoid sending duplicate images to the LLM */
let lastScreenshotHash: string | null = null

const ScreenshotAction = z.object({
  action: z.literal("screenshot"),
})

const BindWindowAction = z.object({
  action: z.literal("bind_window"),
  title: z.string().describe("Window title substring to search for (e.g. \"Chrome\", \"Notepad\")"),
})

const ListWindowsAction = z.object({
  action: z.literal("list_windows"),
})

const ScreenParams = z.discriminatedUnion("action", [
  ScreenshotAction,
  BindWindowAction,
  ListWindowsAction,
])

export const ScreenTool = Tool.define("screen", {
  description: DESCRIPTION,
  parameters: ScreenParams,
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: Record<string, any>; attachments?: { type: "file"; mime: string; url: string }[] }> {
    await ctx.ask({
      permission: "screen",
      patterns: [params.action],
      always: ["*"],
      metadata: { action: params.action },
    })

    switch (params.action) {
      case "screenshot": {
        const result = await Capture.take({ mode: "auto" })
        DesktopState.setBounds(result.windowBounds)
        Capture.cleanup().catch(() => {})

        // Hash the screenshot to detect duplicates
        const hash = createHash("md5").update(result.buffer).digest("hex")
        const isDuplicate = hash === lastScreenshotHash
        lastScreenshotHash = hash

        const coordInfo = result.windowBounds
          ? `Coordinates are relative to the bound window (${result.windowBounds.width}x${result.windowBounds.height} at screen position ${result.windowBounds.x},${result.windowBounds.y}).`
          : "Coordinates are screen-absolute."

        // If screen hasn't changed, skip sending the image to save vision tokens
        if (isDuplicate) {
          return {
            title: `Screenshot unchanged (${result.width}x${result.height})`,
            output: `Screen has NOT changed since the last screenshot (${result.width}x${result.height} pixels). ${coordInfo} No need to re-analyze — use the previous screenshot as reference. If you are waiting for something to load, try using input.wait first, then screenshot again.`,
            metadata: { width: result.width, height: result.height, windowBounds: result.windowBounds, unchanged: true },
          }
        }

        const base64 = result.buffer.toString("base64")
        return {
          title: `Screenshot captured (${result.width}x${result.height})`,
          output: `Screenshot captured: ${result.width}x${result.height} pixels. ${coordInfo}`,
          metadata: { width: result.width, height: result.height, windowBounds: result.windowBounds, unchanged: false },
          attachments: [
            {
              type: "file" as const,
              mime: "image/png",
              url: `data:image/png;base64,${base64}`,
            },
          ],
        }
      }

      case "bind_window": {
        const binding = await WindowManager.bind(params.title)
        DesktopState.setBounds(null) // Reset — next screenshot will set it
        return {
          title: `Bound to "${binding.info.title}"`,
          output: `Bound to window: "${binding.info.title}" (${binding.info.appName}), position: (${binding.info.x}, ${binding.info.y}), size: ${binding.info.width}x${binding.info.height}. Take a screenshot to see the window content — coordinates will be relative to this window.`,
          metadata: {
            windowId: binding.windowId,
            title: binding.info.title,
            appName: binding.info.appName,
            x: binding.info.x,
            y: binding.info.y,
            width: binding.info.width,
            height: binding.info.height,
          },
        }
      }

      case "list_windows": {
        const windows = await WindowManager.listWindows()
        const lines = windows.map(
          (w) => `[${w.id}] "${w.title}" (${w.appName}) — pos: (${w.x},${w.y}), size: ${w.width}x${w.height}${w.isFocused ? " [focused]" : ""}`,
        )
        return {
          title: `Found ${windows.length} windows`,
          output: lines.length > 0 ? lines.join("\n") : "No visible windows found.",
          metadata: { count: windows.length, windows },
        }
      }
    }
  },
})
