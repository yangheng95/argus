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
    matchWindowId?: number
    matchAppName?: string
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

  function pickBestWindow(list: WindowInfo[]): WindowInfo | null {
    if (list.length === 0) return null
    const focused = list.find((w) => w.isFocused)
    if (focused) return focused
    return [...list].sort((a, b) => {
      if (a.isMinimized !== b.isMinimized) {
        return a.isMinimized ? 1 : -1
      }
      return b.width * b.height - a.width * a.height
    })[0] ?? null
  }

  async function findWindowForRebind(binding: WindowBinding): Promise<WindowInfo | null> {
    if (typeof binding.matchWindowId === "number") {
      const byId = await findWindowById(binding.matchWindowId)
      if (byId) return byId
    }
    const query = binding.matchTitle.trim().toLowerCase()
    if (!query) return null
    const windows = await listWindows(true)
    const matches = windows.filter((w) => w.title.toLowerCase().includes(query) || w.appName.toLowerCase().includes(query))
    if (!binding.matchAppName) return pickBestWindow(matches)
    const app = binding.matchAppName.toLowerCase()
    const appMatches = matches.filter((w) => w.appName.toLowerCase() === app)
    if (appMatches.length > 0) return pickBestWindow(appMatches)
    return pickBestWindow(matches)
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

    return pickBestWindow(matches)
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
    const current = await getNativeWindow(windowId)
    if (current?.isFocused()) return true

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
      matchAppName: info.appName,
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
      matchWindowId: info.id,
      matchAppName: info.appName,
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
   * At new task boundaries, re-search previous binding by id first then title.
   * This avoids stale window IDs while preventing drift across duplicate titles.
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
      const info = await findWindowForRebind(previous)
      if (!info) {
        log.warn("task rebind failed: previous window no longer found", {
          matchTitle: previous.matchTitle,
          previousWindowId: previous.windowId,
          matchWindowId: previous.matchWindowId ?? null,
          matchAppName: previous.matchAppName ?? null,
        })
        ws.binding = null
        ws.lastTaskEpoch = taskEpoch
        return null
      }

      ws.binding = {
        windowId: info.id,
        matchTitle: previous.matchTitle,
        matchWindowId: previous.matchWindowId,
        matchAppName: previous.matchAppName ?? info.appName,
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
