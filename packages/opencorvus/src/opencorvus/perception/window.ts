import { Log } from "../../util/log"
import { Instance } from "../../project/instance"

const windowState = Instance.state((): { binding: WindowManager.WindowBinding | null; lastTaskEpoch: number } => ({
  binding: null,
  lastTaskEpoch: -1,
}))

export namespace WindowManager {
  const log = Log.create({ service: "opencorvus-window" })

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

  function norm(text: string): string {
    return text.trim().toLowerCase()
  }

  function gap(a: WindowInfo, b: WindowInfo): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height)
  }

  function pick(windows: WindowInfo[], previous: WindowBinding): WindowInfo | null {
    const title = norm(previous.info.title)
    const app = norm(previous.info.appName)
    const query = norm(previous.matchTitle)
    if (windows.length === 0) return null

    const scored = windows.map((win) => {
      const winTitle = norm(win.title)
      const winApp = norm(win.appName)
      const exactTitle = title.length > 0 && winTitle === title
      const exactApp = app.length > 0 && winApp === app
      const queryExact = query.length > 0 && (winTitle === query || winApp === query)
      const queryHit = query.length > 0 && (winTitle.includes(query) || winApp.includes(query))
      const s =
        (queryExact ? 500 : 0) +
        (exactTitle ? 220 : 0) +
        (exactApp ? 180 : 0) +
        (queryHit ? 120 : 0) +
        (win.isFocused ? 80 : 0) +
        (!win.isMinimized ? 40 : 0) -
        Math.min(200, Math.floor(gap(win, previous.info) / 20))
      return { win, s }
    })

    scored.sort((a, b) => b.s - a.s)
    const best = scored[0]
    if (!best) return null
    return best.s >= 60 ? best.win : null
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

  export async function findWindowById(windowId: number): Promise<WindowInfo | null> {
    const windows = await listWindows(true)
    const match = windows.find((w) => w.id === windowId) ?? null
    if (!match) {
      log.info("no window found", { windowId })
      return null
    }
    return match
  }

  export async function getNativeWindow(windowId: number): Promise<InstanceType<typeof import("node-screenshots").Window> | null> {
    const { Window } = await import("node-screenshots")
    const windows = Window.all()
    return windows.find((w) => w.id() === windowId) ?? null
  }

  // Lazy-loaded cross-platform window action from @nut-tree-fork/libnut.
  // Works on Windows, macOS, and Linux using native APIs under the hood.
  let _windowAction: any = null
  function getWindowAction() {
    if (_windowAction) return _windowAction
    const nutPath = require.resolve("@nut-tree-fork/nut-js")
    const libnutPath = require.resolve("@nut-tree-fork/libnut", { paths: [require("path").dirname(nutPath)] })
    const { DefaultWindowAction } = require(libnutPath)
    _windowAction = new DefaultWindowAction()
    return _windowAction
  }

  /**
   * Focus/activate a window by its native ID (HWND on Windows, XID on Linux, etc.).
   * Uses @nut-tree-fork/libnut for cross-platform focus — works on Windows/macOS/Linux.
   */
  export async function focusWindow(windowId: number, _appName?: string): Promise<boolean> {
    try {
      const wa = getWindowAction()
      await wa.focusWindow(windowId)
      log.info("focusWindow", { windowId })
      return true
    } catch (err) {
      log.warn("failed to focus window", { windowId, err })
      return false
    }
  }

  export async function ensureForeground(windowId: number, appName?: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await focusWindow(windowId, appName)
      await sleep(200 + attempt * 100)
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

  export async function bindById(windowId: number, matchTitle?: string): Promise<WindowBinding> {
    const info = await findWindowById(windowId)
    if (!info) {
      throw new Error(`No window found with id ${windowId}`)
    }

    windowState().binding = {
      windowId: info.id,
      matchTitle: matchTitle?.trim() || info.title || info.appName || String(info.id),
      info,
    }

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
      const previous = ws.binding
      const windows = await listWindows(true)
      const next = pick(windows, previous)
      if (!next) {
        log.warn("bound window disappeared", { windowId: previous.windowId, title: previous.matchTitle })
        ws.binding = null
        return null
      }
      ws.binding = {
        ...previous,
        windowId: next.id,
        info: next,
      }
      log.info("rebound window after id loss", {
        previousWindowId: previous.windowId,
        reboundWindowId: next.id,
        title: next.title,
        appName: next.appName,
      })
      return ws.binding
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
