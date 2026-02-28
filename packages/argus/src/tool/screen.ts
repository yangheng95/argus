import z from "zod"
import { Tool } from "./tool"
import { Capture } from "../argus/perception/capture"
import { WindowManager } from "../argus/perception/window"
import { DesktopState } from "./desktop-state"

const DESCRIPTION = `Observe the desktop environment. Use this tool to take screenshots, list windows, and bind to a specific window.

Actions:
- screenshot: Capture the current screen (or bound window). Returns the image for visual analysis.
- list_windows: List all visible windows with their positions and sizes.
- bind_window: Bind to a specific window by title. Subsequent screenshots capture only that window, and coordinates become window-relative.

Best practices:
- Always take a screenshot first to observe the current state before interacting.
- After performing an action with the input tool, take another screenshot to verify the result.
- Use bind_window to focus on a specific application window for more precise interaction.`

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
        const base64 = result.buffer.toString("base64")
        const coordInfo = result.windowBounds
          ? `Coordinates are relative to the bound window (${result.windowBounds.width}x${result.windowBounds.height} at screen position ${result.windowBounds.x},${result.windowBounds.y}).`
          : "Coordinates are screen-absolute."
        return {
          title: `Screenshot captured (${result.width}x${result.height})`,
          output: `Screenshot captured: ${result.width}x${result.height} pixels. ${coordInfo}`,
          metadata: { width: result.width, height: result.height, windowBounds: result.windowBounds },
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
