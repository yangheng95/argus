import { Log } from "../../util/log"

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

  let _binding: WindowBinding | null = null

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
    const windows = await listWindows(false)
    const query = titleQuery.toLowerCase()

    const matches = windows.filter(
      (w) => w.title.toLowerCase().includes(query) || w.appName.toLowerCase().includes(query),
    )

    if (matches.length === 0) {
      log.info("no window found", { titleQuery })
      return null
    }

    // Priority: focused > largest area > first (z-order from node-screenshots)
    const focused = matches.find((w) => w.isFocused)
    if (focused) return focused

    matches.sort((a, b) => b.width * b.height - a.width * a.height)
    return matches[0]
  }

  export async function getNativeWindow(windowId: number): Promise<InstanceType<typeof import("node-screenshots").Window> | null> {
    const { Window } = await import("node-screenshots")
    const windows = Window.all()
    return windows.find((w) => w.id() === windowId) ?? null
  }

  export async function bind(titleQuery: string): Promise<WindowBinding> {
    const info = await findWindow(titleQuery)
    if (!info) {
      throw new Error(`No window found matching "${titleQuery}"`)
    }

    _binding = {
      windowId: info.id,
      matchTitle: titleQuery,
      info,
    }

    log.info("bound window", { windowId: info.id, title: info.title, appName: info.appName })
    return _binding
  }

  export function unbind(): void {
    log.info("unbound window", { previous: _binding?.info.title ?? "none" })
    _binding = null
  }

  export async function getBinding(): Promise<WindowBinding | null> {
    if (!_binding) return null

    // Refresh window position — the window may have moved or been closed
    const native = await getNativeWindow(_binding.windowId)
    if (!native) {
      log.warn("bound window disappeared", { windowId: _binding.windowId, title: _binding.matchTitle })
      _binding = null
      return null
    }

    _binding.info = {
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

    return _binding
  }

  export function isBound(): boolean {
    return _binding !== null
  }
}
