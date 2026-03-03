import z from "zod"
import { createHash } from "crypto"
import { Tool } from "./tool"
import { Capture } from "../opencorvus/perception/capture"
import { MonitorManager } from "../opencorvus/perception/monitor"
import { WindowManager } from "../opencorvus/perception/window"
import { ScreenDiff } from "../opencorvus/perception/diff"
import { DesktopState } from "./desktop-state"
import { GuiState } from "./gui-state"
import { addCoordinateOverlay, addClickMarker } from "../opencorvus/perception/overlay"
import { Log } from "../util/log"
import { showWindowHighlight } from "./overlay-client"

const log = Log.create({ service: "screen" })
const MAX_ATTACHMENT_BYTES = Number(process.env.OPENCORVUS_SCREEN_MAX_ATTACHMENT_MB ?? "32") * 1024 * 1024
const SCREEN_COMPRESSION_ENABLED = false
const SCREEN_DEBUG_COORDINATE_OVERLAY_ENV = "OPENCORVUS_SCREEN_DEBUG_COORDINATE_OVERLAY"

function bool(input: string | undefined) {
  if (!input) return false
  const value = input.trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}

function debugCoordinateOverlay() {
  return bool(process.env[SCREEN_DEBUG_COORDINATE_OVERLAY_ENV])
}

async function image(buffer: Buffer): Promise<{ mime: string; buffer: Buffer; compressed: boolean }> {
  if (buffer.length <= MAX_ATTACHMENT_BYTES) {
    return { mime: "image/png", buffer, compressed: false }
  }
  const sharp = await import("sharp").then((x) => x.default)
  const attempts = [
    () => sharp(buffer).png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toBuffer(),
    () => sharp(buffer).jpeg({ quality: 95, mozjpeg: false, chromaSubsampling: "4:4:4" }).toBuffer(),
    () => sharp(buffer).jpeg({ quality: 90, mozjpeg: false, chromaSubsampling: "4:4:4" }).toBuffer(),
    () => sharp(buffer).jpeg({ quality: 85, mozjpeg: false, chromaSubsampling: "4:4:4" }).toBuffer(),
  ]
  for (const attempt of attempts) {
    try {
      const next = await attempt()
      if (next.length <= MAX_ATTACHMENT_BYTES) {
        const mime = next[0] === 0x89 && next[1] === 0x50 ? "image/png" : "image/jpeg"
        return { mime, buffer: next, compressed: true }
      }
    } catch {}
  }
  const fallback = await sharp(buffer).jpeg({ quality: 80, mozjpeg: false, chromaSubsampling: "4:4:4" }).toBuffer()
  return { mime: "image/jpeg", buffer: fallback, compressed: true }
}

function monitorForWindow(
  w: { x: number; y: number; width: number; height: number },
  monitors: { id: number; name: string; x: number; y: number; width: number; height: number }[],
) {
  const cx = w.x + Math.floor(w.width / 2)
  const cy = w.y + Math.floor(w.height / 2)
  return monitors.find((m) => cx >= m.x && cy >= m.y && cx < m.x + m.width && cy < m.y + m.height) ?? null
}

function candidateWindows<
  T extends { title: string; isMinimized: boolean; isFocused: boolean; width: number; height: number },
>(windows: T[]): T[] {
  const list = windows.filter((w) => !!w.title && !w.isMinimized && w.width > 100 && w.height > 100)
  return [...list].sort((a, b) => {
    if (a.isFocused !== b.isFocused) return a.isFocused ? -1 : 1
    return b.width * b.height - a.width * a.height
  })
}

function pickWindow(windows: WindowManager.WindowInfo[]): WindowManager.WindowInfo | null {
  return candidateWindows(windows)[0] ?? null
}

const DESCRIPTION = `Observe the desktop environment. Use this tool to take screenshots, list windows, list monitors, and bind a target window or monitor.

Actions:
- screenshot: Capture the current screen (or bound window/monitor). Returns the image for visual analysis. If the screen has not changed since the last screenshot, it will tell you instead of returning the image again (saves analysis time). Set wait_for_change=true to block until the screen actually changes - use this when waiting for page loads, dialogs, or animations instead of polling with repeated screenshots.
- list_monitors: List all monitors with position, size, and scale. Use this as fallback when target windows cannot be found.
- bind_monitor: Bind to a monitor by id or name (e.g. 1, "DELL", "primary"). Screenshots then focus this monitor.
- list_windows: List all visible windows with their positions and sizes. It also returns ranked window_id candidates for model-driven target selection.
- bind_window: Bind to a specific window by window_id (preferred from list_windows) or by title substring fallback. After binding, screenshots capture only that window and coordinates become window-relative.

IMPORTANT workflow:
1. Single-monitor default: start with screenshot and interact directly.
2. If target app/window is ambiguous, use list_windows, choose a window_id, then bind_window.
3. Only if target window cannot be found, use list_monitors + bind_monitor to switch desktop/monitor.
4. Take a screenshot of the bound target to see current content.
5. Interact with the app via the input tool, using coordinates from the screenshot.
6. Take another screenshot to verify the result.

IMPORTANT: After viewing each screenshot, you MUST describe what you see in your text response (visible windows, UI elements, text, key coordinates). Screenshots are automatically removed from context after the current turn - only your text description persists.

Debug option: set ${SCREEN_DEBUG_COORDINATE_OVERLAY_ENV}=1 to render coordinate ticks on returned images. By default, returned screenshots do not include visual coordinate overlays.`

const WaitForChange = z.preprocess((input) => {
  if (typeof input !== "string") return input
  const value = input.trim().toLowerCase()
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  return input
}, z.boolean())

const ScreenshotAction = z.object({
  action: z.literal("screenshot"),
  wait_for_change: WaitForChange.optional().describe("If true, wait until the screen content changes before capturing. Use when waiting for page loads, dialogs, or animations."),
})

const BindWindowAction = z.object({
  action: z.literal("bind_window"),
  window_id: z.coerce.number().int().optional().describe("Exact window id from list_windows. Preferred for deterministic binding."),
  title: z.string().optional().describe("Fallback window title/app substring when window_id is unavailable."),
})

const ListWindowsAction = z.object({
  action: z.literal("list_windows"),
})

const ListMonitorsAction = z.object({
  action: z.literal("list_monitors"),
})

const BindMonitorAction = z.object({
  action: z.literal("bind_monitor"),
  monitor: z.union([z.number().int(), z.string()]).describe("Monitor id or name (e.g. 1, \"DELL\", \"primary\")"),
})

const ScreenParams = z.discriminatedUnion("action", [
  ScreenshotAction,
  BindWindowAction,
  ListWindowsAction,
  ListMonitorsAction,
  BindMonitorAction,
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
        let autoBound = false
        let foregroundFailed = false
        let currentBinding = await WindowManager.getBinding()
        const monitorBinding = await MonitorManager.getBinding()
        const hadFocusChange = WindowManager.consumeFocusChange()

        if (currentBinding && !hadFocusChange) {
          const focused = await WindowManager.ensureBoundForeground()
          if (!focused) {
            log.warn("bound window not foreground, will try window capture anyway", {
              title: currentBinding.info.title,
              appName: currentBinding.info.appName,
            })
            foregroundFailed = true
          }
        } else if (currentBinding && hadFocusChange) {
          // Focus-changing key was pressed — suspend explicit binding
          // so auto-bind picks the newly focused window.
          log.info("focus change detected, suspending binding for this screenshot", {
            previousTitle: currentBinding.info.title,
          })
          WindowManager.unbind()
          currentBinding = null
        }

        if (!currentBinding && !monitorBinding) {
          if (hadFocusChange) {
            // After a focus change, skip auto-bind entirely.
            // Capture the full primary monitor so the LLM sees everything
            // and can list_windows + bind_window to the correct target.
            log.info("focus change: skipping auto-bind, will capture fullscreen")
          } else {
            try {
              const windows = await WindowManager.listWindows()
              const target = pickWindow(windows)
              if (target) {
                // Quiet bind: don't steal focus, just capture
                await WindowManager.bindByIdQuiet(target.id, target.title)
                autoBound = true
                currentBinding = await WindowManager.getBinding()
              }
            } catch {}
          }
        }

        let result = await Capture.take({ mode: "auto" })

        if (params.wait_for_change && result.rawBuffer) {
          const firstHash = createHash("md5").update(result.buffer).digest("hex")
          if (firstHash === GuiState.get().lastScreenshotHash) {
            const baseline: ScreenDiff.ImageData = {
              rawBuffer: result.rawBuffer,
              width: result.width,
              height: result.height,
              timestamp: result.timestamp,
            }
            const pollInterval = 500
            const maxWait = 30_000
            const startTime = Date.now()
            let changed = false

            log.info("wait_for_change: screen unchanged, polling for changes", {
              maxWait,
              pollInterval,
            })

            while (Date.now() - startTime < maxWait) {
              if (ctx.abort.aborted) break
              await new Promise((r) => setTimeout(r, pollInterval))
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
                if (!diff.changed) continue
                result = probe
                changed = true
                log.info("wait_for_change: change detected", {
                  diffPercent: diff.diffPercent.toFixed(1),
                  elapsed: Date.now() - startTime,
                })
                break
              } catch {}
            }

            if (!changed) {
              log.info("wait_for_change: timeout, returning current state", {
                elapsed: Date.now() - startTime,
              })
            }
          }
        }

        DesktopState.setBounds(result.windowBounds)
        if (result.scope === "window") {
          const binding = await WindowManager.getBinding()
          DesktopState.setTarget(binding ? { scope: "window", windowId: binding.windowId, title: binding.info.title } : null)
        } else if (result.monitor) {
          DesktopState.setTarget({
            scope: "monitor",
            monitorId: result.monitor.id,
            name: result.monitor.name,
          })
        } else {
          DesktopState.setTarget(null)
        }
        Capture.cleanup().catch(() => {})

        if (autoBound) {
          WindowManager.unbind()
        }

        const hash = createHash("md5").update(result.buffer).digest("hex")
        const isDuplicate = hash === GuiState.get().lastScreenshotHash

        GuiState.recordScreenshot(hash, result.width, result.height, isDuplicate)
        GuiState.updateRepetition(!isDuplicate)

        log.info("screenshot-capture", {
          imageWidth: result.width,
          imageHeight: result.height,
          bufferBytes: result.buffer.length,
          hash: hash.substring(0, 8),
          isDuplicate,
          autoBound,
          scope: result.scope,
          monitorId: result.monitor?.id ?? null,
          windowBounds: result.windowBounds
            ? `${result.windowBounds.width}x${result.windowBounds.height}@${result.windowBounds.x},${result.windowBounds.y}`
            : "none",
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
        const coordInfo = result.scope === "window" && result.windowBounds
          ? `Coordinates are relative to the bound window (${result.windowBounds.width}x${result.windowBounds.height} at screen position ${result.windowBounds.x},${result.windowBounds.y}).${scaleInfo}`
          : result.windowBounds
            ? `Coordinates are relative to monitor "${result.monitor?.name ?? result.monitor?.id ?? "unknown"}" (${result.windowBounds.width}x${result.windowBounds.height} at screen position ${result.windowBounds.x},${result.windowBounds.y}).${scaleInfo}`
            : "Coordinates are screen-absolute."

        const platformName = process.platform === "darwin" ? "macOS" : process.platform === "linux" ? "Linux" : "Windows"
        const shortcutHint = process.platform === "darwin" ? "Use Cmd for shortcuts (Cmd+C, Cmd+V, etc.)." : "Use Ctrl for shortcuts (Ctrl+C, Ctrl+V, etc.)."

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
            output: `Screen has NOT changed since the last screenshot (${result.width}x${result.height} pixels). ${coordInfo} Platform: ${platformName}. ${shortcutHint} No need to re-analyze - use the previous screenshot as reference. If you are waiting for something to load, prefer screen.screenshot with wait_for_change=true, then retry.`,
            metadata: {
              width: result.width,
              height: result.height,
              windowBounds: result.windowBounds,
              unchanged: true,
              screenshotHash: hash,
              scope: result.scope,
              monitor: result.monitor,
              scaleX: result.windowBounds?.scaleX ?? 1,
              scaleY: result.windowBounds?.scaleY ?? 1,
            },
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

        const encoded = SCREEN_COMPRESSION_ENABLED
          ? await image(result.buffer)
          : { mime: "image/png", buffer: result.buffer, compressed: false }
        const debugOverlay = debugCoordinateOverlay()
        let attachment = debugOverlay ? await addCoordinateOverlay(encoded.buffer).catch(() => encoded.buffer) : encoded.buffer

        // Draw click marker if there was a recent click action
        const lastClick = DesktopState.consumeLastClick()
        let clickMarkerInfo = ""
        if (lastClick && (Date.now() - lastClick.time) < 10_000) {
          try {
            attachment = await addClickMarker(attachment, lastClick.imageX, lastClick.imageY, `${lastClick.action}(${lastClick.imageX},${lastClick.imageY})`)
            clickMarkerInfo = ` A green crosshair marker shows your previous ${lastClick.action} at (${lastClick.imageX},${lastClick.imageY}).`
            log.info("click-marker-applied", { x: lastClick.imageX, y: lastClick.imageY, action: lastClick.action })
          } catch (e) {
            log.warn("click-marker-failed", { error: e instanceof Error ? e.message : String(e) })
          }
        }

        const outputMime = attachment[0] === 0x89 && attachment[1] === 0x50 ? "image/png" : "image/jpeg"
        const base64 = attachment.toString("base64")
        const overlayInfo = (debugOverlay
          ? ` Debug mode: coordinate ticks are visible on the image (${SCREEN_DEBUG_COORDINATE_OVERLAY_ENV}=1).`
          : " Shared image has no visible coordinate overlay.") + clickMarkerInfo

        const rep = GuiState.get().repetition
        if (rep.consecutiveNoChange >= 6) {
          return {
            title: `Screenshot captured (${result.width}x${result.height}) - STUCK`,
            output: `Screenshot captured: ${result.width}x${result.height} pixels. ${coordInfo} Platform: ${platformName}. ${shortcutHint}\n\n` +
              `${overlayInfo}\n\n` +
              `*** STUCK: ${rep.consecutiveNoChange} previous actions had no effect. ***\n` +
              `You MUST try a fundamentally different approach.\n` +
              `1. Press Esc to dismiss hidden overlays\n` +
              `2. Use keyboard (Tab, Enter) instead of clicking\n` +
              `3. If multiple windows are competing, use list_windows to find dialogs\n` +
              `4. Try a completely different UI path`,
            metadata: {
              width: result.width,
              height: result.height,
              windowBounds: result.windowBounds,
              unchanged: false,
              screenshotHash: hash,
              scope: result.scope,
              monitor: result.monitor,
              stuck: true,
              compressed: encoded.compressed,
              attachmentBytes: attachment.length,
              debugCoordinateOverlay: debugOverlay,
              scaleX: result.windowBounds?.scaleX ?? 1,
              scaleY: result.windowBounds?.scaleY ?? 1,
            },
            attachments: [
              {
                type: "file" as const,
                mime: outputMime,
                url: `data:${outputMime};base64,${base64}`,
              },
            ],
          }
        }

        const foregroundNote = foregroundFailed
          ? ` Note: The bound window was not in the foreground, but the screenshot was captured from it anyway. If input actions miss the target, use input.key("alt+tab") to bring the window to front first.`
          : ""
        const focusChangeNote = hadFocusChange && autoBound
          ? ` A focus-changing key was detected. This screenshot shows the currently focused window. If this is not the expected window, use screen.list_windows + screen.bind_window to target the correct one.`
          : ""
        return {
          title: `Screenshot captured (${result.width}x${result.height})${foregroundFailed ? " [window not focused]" : ""}`,
          output: `Screenshot captured: ${result.width}x${result.height} pixels. ${coordInfo} Platform: ${platformName}. ${shortcutHint}${overlayInfo}${foregroundNote}${focusChangeNote}`,
          metadata: {
            width: result.width,
            height: result.height,
            windowBounds: result.windowBounds,
            unchanged: false,
            screenshotHash: hash,
            scope: result.scope,
            monitor: result.monitor,
            compressed: encoded.compressed,
            attachmentBytes: attachment.length,
            debugCoordinateOverlay: debugOverlay,
            scaleX: result.windowBounds?.scaleX ?? 1,
            scaleY: result.windowBounds?.scaleY ?? 1,
          },
          attachments: [
            {
              type: "file" as const,
              mime: outputMime,
              url: `data:${outputMime};base64,${base64}`,
            },
          ],
        }
      }

      case "bind_window": {
        GuiState.activate()
        const query = params.title?.trim() ?? ""
        const requestedWindowId = params.window_id
        const [windows, monitors] = await Promise.all([WindowManager.listWindows(true), MonitorManager.listMonitors()])
        const pickedById = typeof requestedWindowId === "number"
          ? windows.find((w) => w.id === requestedWindowId) ?? null
          : null
        const match = pickedById ?? (query ? await WindowManager.findWindow(query) : null)
        const fallback = !match && query && monitors.length === 1
          ? pickWindow(windows)
          : null
        const picked = match ?? fallback
        if (!picked) {
          if (typeof requestedWindowId === "number" && query) {
            throw new Error(`No window found with id ${requestedWindowId} or matching "${query}"`)
          }
          if (typeof requestedWindowId === "number") {
            throw new Error(`No window found with id ${requestedWindowId}`)
          }
          if (query) {
            throw new Error(`No window found matching "${query}"`)
          }
          throw new Error("No window found to bind")
        }
        const mode = pickedById ? "window_id" : fallback ? "single_monitor_fallback" : "title"
        const binding = await WindowManager.bindById(picked.id, query || undefined)
        const idFallbackNote = typeof requestedWindowId === "number" && !pickedById && query
          ? ` Requested window_id ${requestedWindowId} did not match any window, so title matching selected "${binding.info.title}".`
          : ""
        const fallbackNote = fallback
          ? ` Requested "${query || "focused"}" did not match any window, so single-monitor fallback bound "${binding.info.title}".`
          : ""
        showWindowHighlight({
          x: binding.info.x,
          y: binding.info.y,
          width: binding.info.width,
          height: binding.info.height,
          label: binding.info.title,
          durationMs: 1600,
        })
        DesktopState.setBounds(null)
        DesktopState.setTarget({
          scope: "window",
          windowId: binding.windowId,
          title: binding.info.title,
        })
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
          output: `Bound to window: "${binding.info.title}" (${binding.info.appName}), position: (${binding.info.x}, ${binding.info.y}), size: ${binding.info.width}x${binding.info.height}.${idFallbackNote}${fallbackNote} Take a screenshot to see the window content - coordinates will be relative to this window.`,
          metadata: {
            windowId: binding.windowId,
            title: binding.info.title,
            appName: binding.info.appName,
            x: binding.info.x,
            y: binding.info.y,
            width: binding.info.width,
            height: binding.info.height,
            requestedTitle: query || null,
            requestedWindowId: requestedWindowId ?? null,
            selectionMode: mode,
            idFallback: typeof requestedWindowId === "number" && !pickedById,
            singleMonitorFallback: !!fallback,
            monitorCount: monitors.length,
          },
        }
      }

      case "bind_monitor": {
        GuiState.activate()
        const binding = await MonitorManager.bind(params.monitor)
        WindowManager.unbind()
        DesktopState.setBounds(null)
        DesktopState.setTarget({
          scope: "monitor",
          monitorId: binding.monitorId,
          name: binding.info.name,
        })
        GuiState.recordAction({
          time: Date.now(),
          tool: "screen",
          action: "bind_monitor",
          detail: `"${binding.info.name}"`,
          screenshotHashAfter: null,
          screenChanged: null,
        })
        return {
          title: `Bound to monitor ${binding.info.id}`,
          output: `Bound to monitor: "${binding.info.name}" (id ${binding.info.id}), position: (${binding.info.x}, ${binding.info.y}), size: ${binding.info.width}x${binding.info.height}, scale: ${binding.info.scaleFactor}. Take a screenshot to inspect this monitor.`,
          metadata: binding.info,
        }
      }

      case "list_windows": {
        GuiState.activate()
        const [windows, monitors] = await Promise.all([WindowManager.listWindows(), MonitorManager.listMonitors()])
        const enriched = windows.map((w) => {
          const monitor = monitorForWindow(w, monitors)
          return {
            ...w,
            monitorId: monitor?.id ?? null,
            monitorName: monitor?.name ?? null,
          }
        })
        const lines = enriched.map(
          (w) => `[${w.id}] "${w.title}" (${w.appName}) - pos: (${w.x},${w.y}), size: ${w.width}x${w.height}, monitor: ${w.monitorId ?? "?"}${w.isFocused ? " [focused]" : ""}`,
        )
        const candidates = candidateWindows(enriched).map((w) => ({
          window_id: w.id,
          title: w.title,
          appName: w.appName,
          monitorId: w.monitorId,
          isFocused: w.isFocused,
          width: w.width,
          height: w.height,
        }))
        const candidateLines = candidates.slice(0, 8).map(
          (w, i) => `${i === 0 ? "*" : "-"} window_id=${w.window_id} "${w.title}" (${w.appName}) on monitor ${w.monitorId ?? "?"}${w.isFocused ? " [focused]" : ""}`,
        )
        const candidateHint = candidateLines.length > 0
          ? `\n\nSelectable targets (best first):\n${candidateLines.join("\n")}\nBind one with: screen.bind_window({ window_id: <id> })`
          : ""
        const monitorFallbackHint = "\nIf target app/window is not listed, then use screen.list_monitors and screen.bind_monitor to switch desktop/monitor."
        const singleMonitorHint = "\nOn single-monitor setups you often can continue with screen.screenshot + input directly without list_windows."
        return {
          title: `Found ${enriched.length} windows`,
          output: lines.length > 0
            ? lines.join("\n") + candidateHint + singleMonitorHint + monitorFallbackHint
            : "No visible windows found. Use screen.list_monitors and screen.bind_monitor if the app may be on another desktop/monitor.",
          metadata: { count: enriched.length, windows: enriched, candidates },
        }
      }

      case "list_monitors": {
        GuiState.activate()
        const monitors = await MonitorManager.listMonitors()
        const lines = monitors.map(
          (m) => `[${m.id}] "${m.name}" - pos: (${m.x},${m.y}), size: ${m.width}x${m.height}, scale: ${m.scaleFactor}${m.isPrimary ? " [primary]" : ""}`,
        )
        return {
          title: `Found ${monitors.length} monitors`,
          output: lines.length > 0 ? lines.join("\n") : "No monitors found.",
          metadata: { count: monitors.length, monitors },
        }
      }
    }
  },
})
