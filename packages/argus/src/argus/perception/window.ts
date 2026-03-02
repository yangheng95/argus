import { Log } from "../../util/log"
import { Instance } from "../../project/instance"
import os from "os"
import path from "path"
import { writeFile, unlink } from "fs/promises"

const windowState = Instance.state((): { binding: WindowManager.WindowBinding | null; lastTaskEpoch: number } => ({
  binding: null,
  lastTaskEpoch: -1,
}))

export namespace WindowManager {
  const log = Log.create({ service: "argus-window" })

  export interface WindowInfo {
    id: number
    title: string
    appName: string
    x: number
    y: number
    width: number
    height: number
    isMinimized: boolean
    isFocused: boolean
  }

  export interface WindowBinding {
    windowId: number
    matchTitle: string
    info: WindowInfo
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  export async function listWindows(includeMinimized = false): Promise<WindowInfo[]> {
    const { Window } = await import("node-screenshots")
    const windows = Window.all()

    const result: WindowInfo[] = []
    for (const w of windows) {
      const minimized = w.isMinimized()
      if (!includeMinimized && minimized) continue

      result.push({
        id: w.id(),
        title: w.title(),
        appName: w.appName(),
        x: w.x(),
        y: w.y(),
        width: w.width(),
        height: w.height(),
        isMinimized: minimized,
        isFocused: w.isFocused(),
      })
    }

    log.info("listed windows", { count: result.length, includeMinimized })
    return result
  }

  export async function findWindow(titleQuery: string): Promise<WindowInfo | null> {
    // Include minimized windows so bind/rebind can restore them to foreground.
    const windows = await listWindows(true)
    const query = titleQuery.trim().toLowerCase()
    if (!query) {
      log.warn("empty window query")
      return null
    }

    const matches = windows.filter(
      (w) => w.title.toLowerCase().includes(query) || w.appName.toLowerCase().includes(query),
    )

    if (matches.length === 0) {
      log.info("no window found", { titleQuery })
      return null
    }

    // Priority: focused > non-minimized > largest area
    const focused = matches.find((w) => w.isFocused)
    if (focused) return focused

    matches.sort((a, b) => {
      if (a.isMinimized !== b.isMinimized) {
        return a.isMinimized ? 1 : -1
      }
      return b.width * b.height - a.width * a.height
    })
    return matches[0]
  }

  export async function getNativeWindow(windowId: number): Promise<InstanceType<typeof import("node-screenshots").Window> | null> {
    const { Window } = await import("node-screenshots")
    const windows = Window.all()
    return windows.find((w) => w.id() === windowId) ?? null
  }

  /**
   * Focus/activate a window by its native ID.
   * Uses platform-specific best-effort activation.
   * On Windows, uses AttachThreadInput to bypass foreground-lock restrictions.
   */
  export async function focusWindow(windowId: number, appName?: string): Promise<boolean> {
    try {
      if (process.platform === "win32") {
        // Write a .ps1 script to temp dir to avoid command-line escaping issues.
        // AttachThreadInput attaches to the current foreground window's input thread,
        // which grants us permission to call SetForegroundWindow from a background process.
        const scriptPath = path.join(os.tmpdir(), `argus_focus_${windowId}.ps1`)
        const script = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ArgusF${windowId} {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll")] public static extern int GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(int a, int b, bool c);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$hwnd = [IntPtr]${windowId}
$fg   = [ArgusF${windowId}]::GetForegroundWindow()
$pid  = 0
$fgTid = [ArgusF${windowId}]::GetWindowThreadProcessId($fg, [ref]$pid)
$myTid = [ArgusF${windowId}]::GetCurrentThreadId()
[ArgusF${windowId}]::AttachThreadInput($myTid, $fgTid, $true)  | Out-Null
[ArgusF${windowId}]::ShowWindow($hwnd, 9)                       | Out-Null
[ArgusF${windowId}]::BringWindowToTop($hwnd)                    | Out-Null
[ArgusF${windowId}]::SetForegroundWindow($hwnd)                 | Out-Null
[ArgusF${windowId}]::AttachThreadInput($myTid, $fgTid, $false) | Out-Null
`
        await writeFile(scriptPath, script, "utf-8")
        try {
          const { execSync } = await import("child_process")
          execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
            timeout: 5000,
            stdio: "ignore",
          })
        } finally {
          unlink(scriptPath).catch(() => {})
        }
        return true
      }

      if (process.platform === "darwin") {
        if (!appName) return false
        const { execFileSync } = await import("child_process")
        const escaped = appName.replace(/"/g, "\\\"")
        execFileSync("osascript", ["-e", `tell application \"${escaped}\" to activate`], {
          timeout: 5000,
          stdio: "ignore",
        })
        return true
      }

      if (process.platform === "linux") {
        const { execFileSync } = await import("child_process")
        const isWayland = !!process.env.WAYLAND_DISPLAY
        const hasX11 = !!process.env.DISPLAY

        if (isWayland && !hasX11) {
          log.warn("window focus not supported on pure Wayland; install XWayland or use a Wayland-native compositor tool", { windowId })
          return false
        }

        // X11 or XWayland: try xdotool then wmctrl
        try {
          execFileSync("xdotool", ["windowactivate", "--sync", String(windowId)], {
            timeout: 5000,
            stdio: "ignore",
          })
          return true
        } catch {
          // Fall through to wmctrl
        }

        const hex = `0x${windowId.toString(16)}`
        try {
          execFileSync("wmctrl", ["-ia", hex], {
            timeout: 5000,
            stdio: "ignore",
          })
          return true
        } catch {
          return false
        }
      }

      return false
    } catch (err) {
      log.warn("failed to focus window", { windowId, appName, err })
      return false
    }
  }

  export async function ensureForeground(windowId: number, appName?: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await focusWindow(windowId, appName)
      await sleep(120)
      const native = await getNativeWindow(windowId)
      if (native?.isFocused()) {
        log.info("focused window", { windowId, attempt })
        return true
      }
    }
    return false
  }

  export async function ensureBoundForeground(): Promise<boolean> {
    const binding = await getBinding()
    if (!binding) return false
    return ensureForeground(binding.windowId, binding.info.appName)
  }

  export async function bind(titleQuery: string): Promise<WindowBinding> {
    const normalizedQuery = titleQuery.trim()
    if (!normalizedQuery) {
      throw new Error("Window title query cannot be empty")
    }

    const info = await findWindow(normalizedQuery)
    if (!info) {
      throw new Error(`No window found matching "${normalizedQuery}"`)
    }

    windowState().binding = {
      windowId: info.id,
      matchTitle: normalizedQuery,
      info,
    }

    // Bring window to foreground after binding.
    const focused = await ensureForeground(info.id, info.appName)
    if (!focused) {
      log.warn("bound window not confirmed focused", { windowId: info.id, title: info.title, appName: info.appName })
    }

    log.info("bound window", { windowId: info.id, title: info.title, appName: info.appName, focused })
    return windowState().binding!
  }

  /**
   * At new task boundaries, re-search previous binding by matchTitle.
   * This avoids stale window IDs and supports task-to-task rebinding.
   */
  export async function rebindForTask(taskEpoch: number): Promise<WindowBinding | null> {
    const ws = windowState()
    if (taskEpoch < 0 || ws.lastTaskEpoch === taskEpoch) return ws.binding

    if (!ws.binding) {
      ws.lastTaskEpoch = taskEpoch
      return null
    }

    const previous = ws.binding
    try {
      const info = await findWindow(previous.matchTitle)
      if (!info) {
        log.warn("task rebind failed: previous window no longer found", {
          matchTitle: previous.matchTitle,
          previousWindowId: previous.windowId,
        })
        ws.binding = null
        ws.lastTaskEpoch = taskEpoch
        return null
      }

      ws.binding = {
        windowId: info.id,
        matchTitle: previous.matchTitle,
        info,
      }

      const focused = await ensureForeground(info.id, info.appName)
      if (!focused) {
        log.warn("task rebind: window found but not focused", {
          windowId: info.id,
          title: info.title,
          appName: info.appName,
        })
      }

      ws.lastTaskEpoch = taskEpoch
      return ws.binding
    } catch (err) {
      // Keep previous binding and allow retries in this task on the next action.
      log.warn("task rebind errored; will retry", {
        matchTitle: previous.matchTitle,
        previousWindowId: previous.windowId,
        err,
      })
      return ws.binding
    }
  }

  export function unbind(): void {
    log.info("unbound window", { previous: windowState().binding?.info.title ?? "none" })
    windowState().binding = null
  }

  export async function getBinding(): Promise<WindowBinding | null> {
    const ws = windowState()
    if (!ws.binding) return null

    // Refresh window position — the window may have moved or been closed.
    const native = await getNativeWindow(ws.binding.windowId)
    if (!native) {
      log.warn("bound window disappeared", { windowId: ws.binding.windowId, title: ws.binding.matchTitle })
      ws.binding = null
      return null
    }

    ws.binding.info = {
      id: native.id(),
      title: native.title(),
      appName: native.appName(),
      x: native.x(),
      y: native.y(),
      width: native.width(),
      height: native.height(),
      isMinimized: native.isMinimized(),
      isFocused: native.isFocused(),
    }

    return ws.binding
  }

  export function isBound(): boolean {
    return windowState().binding !== null
  }
}
