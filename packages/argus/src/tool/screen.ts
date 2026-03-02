import z from "zod"
import { createHash } from "crypto"
import { Tool } from "./tool"
import { Capture } from "../argus/perception/capture"
import { WindowManager } from "../argus/perception/window"
import { ScreenDiff } from "../argus/perception/diff"
import { DesktopState } from "./desktop-state"
import { GuiState } from "./gui-state"
import { addCoordinateOverlay } from "../argus/perception/overlay"
import { Log } from "../util/log"

const log = Log.create({ service: "screen" })

const DESCRIPTION = `Observe the desktop environment. Use this tool to take screenshots, list windows, and bind to a specific window.

Actions:
- screenshot: Capture the current screen (or bound window). Returns the image for visual analysis. If the screen has not changed since the last screenshot, it will tell you instead of returning the image again (saves analysis time). Set wait_for_change=true to block until the screen actually changes — use this when waiting for page loads, dialogs, or animations instead of polling with repeated screenshots.
- list_windows: List all visible windows with their positions and sizes. Use this to find windows before interacting.
- bind_window: Bind to a specific window by title substring. After binding, screenshots capture only that window and coordinates become window-relative to it.

IMPORTANT workflow:
1. Use list_windows FIRST to see what apps are open and find the one you need.
2. Use bind_window to focus on the target app — this makes coordinates easier and screenshots cleaner.
3. Take a screenshot of the bound window to see its content.
4. Interact with the app via the input tool, using coordinates from the screenshot.
5. Take another screenshot to verify the result.

IMPORTANT: After viewing each screenshot, you MUST describe what you see in your text response (visible windows, UI elements, text, key coordinates). Screenshots are automatically removed from context after the current turn — only your text description persists.`


const ScreenshotAction = z.object({
  action: z.literal("screenshot"),
  wait_for_change: z.boolean().optional().describe("If true, wait until the screen content changes before capturing. Use when waiting for page loads, dialogs, or animations."),
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
        GuiState.activate()

        // If no window is bound, try to auto-bind to the focused window.
        // This captures only the active window instead of the full desktop,
        // producing smaller, more relevant screenshots for the vision LLM.
        let autoBound = false
        const currentBinding = await WindowManager.getBinding()
        if (!currentBinding) {
          try {
            const windows = await WindowManager.listWindows()
            const focused = windows.find((w) => w.isFocused)
            if (focused && focused.title && focused.width > 100 && focused.height > 100) {
              await WindowManager.bind(focused.title)
              autoBound = true
            }
          } catch {
            // Silently fall back to fullscreen
          }
        }

        let result = await Capture.take({ mode: "auto" })

        // wait_for_change: if the screen hasn't changed, poll cheaply until it does
        if (params.wait_for_change && result.rawBuffer) {
          const firstHash = createHash("md5").update(result.buffer).digest("hex")
          if (firstHash === GuiState.get().lastScreenshotHash) {
            const baseline: ScreenDiff.ImageData = {
              rawBuffer: result.rawBuffer,
              width: result.width,
              height: result.height,
              timestamp: result.timestamp,
            }
            const POLL_INTERVAL = 500
            const MAX_WAIT = 30_000
            const startTime = Date.now()

            log.info("wait_for_change: screen unchanged, polling for changes", {
              maxWait: MAX_WAIT,
              pollInterval: POLL_INTERVAL,
            })

            let changed = false
            while (Date.now() - startTime < MAX_WAIT) {
              if (ctx.abort.aborted) break
              await new Promise((r) => setTimeout(r, POLL_INTERVAL))
              if (ctx.abort.aborted) break

              try {
                const probe = await Capture.take({ mode: "auto" })
                if (!probe.rawBuffer) continue
                const diff = await ScreenDiff.compare(baseline, {
                  rawBuffer: probe.rawBuffer,
                  width: probe.width,
                  height: probe.height,
                  timestamp: probe.timestamp,
                })
                if (diff.changed) {
                  result = probe
                  changed = true
                  log.info("wait_for_change: change detected", {
                    diffPercent: diff.diffPercent.toFixed(1),
                    elapsed: Date.now() - startTime,
                  })
                  break
                }
              } catch {
                // Capture or compare failed — skip this round
              }
            }

            if (!changed) {
              log.info("wait_for_change: timeout, returning current state", {
                elapsed: Date.now() - startTime,
              })
            }
          }
        }

        DesktopState.setBounds(result.windowBounds)
        Capture.cleanup().catch(() => {})

        // Unbind if we auto-bound (so the LLM can still bind to other windows)
        if (autoBound) {
          WindowManager.unbind()
        }

        // Hash the raw screenshot to detect duplicates
        const hash = createHash("md5").update(result.buffer).digest("hex")
        const isDuplicate = hash === GuiState.get().lastScreenshotHash

        // Record to GuiState (also updates lastScreenshotHash)
        GuiState.recordScreenshot(hash, result.width, result.height, isDuplicate)
        GuiState.updateRepetition(!isDuplicate)

        // Diagnostic logging for screenshot capture
        log.info("screenshot-capture", {
          imageWidth: result.width,
          imageHeight: result.height,
          bufferBytes: result.buffer.length,
          hash: hash.substring(0, 8),
          isDuplicate,
          autoBound,
          windowBounds: result.windowBounds
            ? `${result.windowBounds.width}x${result.windowBounds.height}@${result.windowBounds.x},${result.windowBounds.y}`
            : "fullscreen",
          pixelScale: result.windowBounds?.scaleX && result.windowBounds?.scaleY
            ? `${result.windowBounds.scaleX.toFixed(3)}x${result.windowBounds.scaleY.toFixed(3)}`
            : "1.000x1.000",
          consecutiveNoChange: GuiState.get().repetition.consecutiveNoChange,
        })

        const hasScaleCompensation = !!result.windowBounds && (
          Math.abs((result.windowBounds.scaleX ?? 1) - 1) > 0.01 ||
          Math.abs((result.windowBounds.scaleY ?? 1) - 1) > 0.01
        )
        const scaleInfo = hasScaleCompensation
          ? ` DPI scale compensation active (${(result.windowBounds?.scaleX ?? 1).toFixed(2)}x, ${(result.windowBounds?.scaleY ?? 1).toFixed(2)}x).`
          : ""
        const coordInfo = result.windowBounds
          ? `Coordinates are relative to the bound window (${result.windowBounds.width}x${result.windowBounds.height} at screen position ${result.windowBounds.x},${result.windowBounds.y}).${scaleInfo}`
          : "Coordinates are screen-absolute."

        const platformName = process.platform === "darwin" ? "macOS" : process.platform === "linux" ? "Linux" : "Windows"
        const shortcutHint = process.platform === "darwin" ? "Use Cmd for shortcuts (Cmd+C, Cmd+V, etc.)." : "Use Ctrl for shortcuts (Ctrl+C, Ctrl+V, etc.)."

        // If screen hasn't changed, skip sending the image to save vision tokens
        if (isDuplicate) {
          GuiState.recordAction({
            time: Date.now(),
            tool: "screen",
            action: "screenshot",
            detail: `${result.width}x${result.height}`,
            screenshotHashAfter: hash,
            screenChanged: false,
          })
          return {
            title: `Screenshot unchanged (${result.width}x${result.height})`,
            output: `Screen has NOT changed since the last screenshot (${result.width}x${result.height} pixels). ${coordInfo} Platform: ${platformName}. ${shortcutHint} No need to re-analyze — use the previous screenshot as reference. If you are waiting for something to load, try using input.wait first, then screenshot again.`,
            metadata: { width: result.width, height: result.height, windowBounds: result.windowBounds, unchanged: true, screenshotHash: hash, scaleX: result.windowBounds?.scaleX ?? 1, scaleY: result.windowBounds?.scaleY ?? 1 },
          }
        }

        GuiState.recordAction({
          time: Date.now(),
          tool: "screen",
          action: "screenshot",
          detail: `${result.width}x${result.height}`,
          screenshotHashAfter: hash,
          screenChanged: true,
        })

        // ── A2A Mode: Route through VisionAgent, return text only ──
        if (A2AState.isActive()) {
          try {
            const binding = await WindowManager.getBinding()
            const vision = await VisionAgent.analyze({
              screenshot: result.buffer,
              context: "Screenshot taken during GUI operation step",
              previousSummary: A2AState.get()?.visionSummary,
              boundWindow: binding
                ? { title: binding.info.title, width: binding.info.width, height: binding.info.height }
                : undefined,
            })
            A2AState.setVisionSummary(vision.runningSummary)
            const visionText = VisionAgent.toText(vision)

            return {
              title: `Screenshot analyzed (${result.width}x${result.height})`,
              output: `${visionText}\n\n${coordInfo} Platform: ${platformName}. ${shortcutHint}`,
              metadata: {
                width: result.width,
                height: result.height,
                windowBounds: result.windowBounds,
                unchanged: false,
                screenshotHash: hash,
                a2a: true,
                elementsFound: vision.elements.length,
              },
              // NO attachments — screenshot stays out of the conversation
            }
          } catch (visionErr) {
            log.warn("A2A vision analysis failed, falling back to image", { err: visionErr })
            // Fall through to normal behavior
          }
        }

        // Add coordinate grid overlay to help vision LLM locate positions
        const annotated = await addCoordinateOverlay(result.buffer).catch(() => result.buffer)
        const base64 = annotated.toString("base64")

        // Check if agent is stuck — append corrective guidance
        const rep = GuiState.get().repetition
        if (rep.consecutiveNoChange >= 6) {
          return {
            title: `Screenshot captured (${result.width}x${result.height}) — STUCK`,
            output: `Screenshot captured: ${result.width}x${result.height} pixels. ${coordInfo} Platform: ${platformName}. ${shortcutHint}\n\n` +
              `*** STUCK: ${rep.consecutiveNoChange} previous actions had no effect. ***\n` +
              `You MUST try a fundamentally different approach.\n` +
              `1. Press Esc to dismiss hidden overlays\n` +
              `2. Use keyboard (Tab, Enter) instead of clicking\n` +
              `3. Use list_windows to find new dialogs\n` +
              `4. Try a completely different UI path`,
            metadata: { width: result.width, height: result.height, windowBounds: result.windowBounds, unchanged: false, screenshotHash: hash, stuck: true, scaleX: result.windowBounds?.scaleX ?? 1, scaleY: result.windowBounds?.scaleY ?? 1 },
            attachments: [
              {
                type: "file" as const,
                mime: "image/png",
                url: `data:image/png;base64,${base64}`,
              },
            ],
          }
        }

        return {
          title: `Screenshot captured (${result.width}x${result.height})`,
          output: `Screenshot captured: ${result.width}x${result.height} pixels. ${coordInfo} Platform: ${platformName}. ${shortcutHint} The image has coordinate tick marks along the edges for precise positioning.`,
          metadata: { width: result.width, height: result.height, windowBounds: result.windowBounds, unchanged: false, screenshotHash: hash, scaleX: result.windowBounds?.scaleX ?? 1, scaleY: result.windowBounds?.scaleY ?? 1 },
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
        GuiState.activate()
        const binding = await WindowManager.bind(params.title)
        DesktopState.setBounds(null) // Reset — next screenshot will set it
        GuiState.recordAction({
          time: Date.now(),
          tool: "screen",
          action: "bind_window",
          detail: `"${binding.info.title}"`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
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
        GuiState.activate()
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
