import { Instance } from "../../project/instance"
import { Log } from "../../util/log"

const state = Instance.state((): { binding: MonitorManager.MonitorBinding | null } => ({
  binding: null,
}))

export namespace MonitorManager {
  const log = Log.create({ service: "opencorvus-monitor" })

  export interface MonitorInfo {
    id: number
    name: string
    x: number
    y: number
    width: number
    height: number
    isPrimary: boolean
    scaleFactor: number
  }

  export interface MonitorBinding {
    monitorId: number
    match: string
    info: MonitorInfo
  }

  export async function listMonitors(): Promise<MonitorInfo[]> {
    const { Monitor } = await import("node-screenshots")
    const monitors = Monitor.all()
    const result = monitors.map((m) => {
      const scale = m.scaleFactor()
      // Monitor.width()/height() return PHYSICAL pixels; derive logical via scaleFactor.
      const logicalWidth = scale > 0 ? Math.round(m.width() / scale) : m.width()
      const logicalHeight = scale > 0 ? Math.round(m.height() / scale) : m.height()
      return {
        id: m.id(),
        name: m.name(),
        x: m.x(),
        y: m.y(),
        width: logicalWidth,
        height: logicalHeight,
        isPrimary: m.isPrimary(),
        scaleFactor: scale,
      }
    })
    log.info("listed monitors", { count: result.length })
    return result
  }

  export async function findMonitor(query: string | number): Promise<MonitorInfo | null> {
    const monitors = await listMonitors()
    if (monitors.length === 0) return null
    if (typeof query === "number") {
      return monitors.find((m) => m.id === query) ?? null
    }
    const normalized = query.trim().toLowerCase()
    if (!normalized) return null
    const id = Number(normalized)
    if (Number.isFinite(id)) {
      const exact = monitors.find((m) => m.id === id)
      if (exact) return exact
    }
    if (normalized === "primary" || normalized === "main") {
      return monitors.find((m) => m.isPrimary) ?? monitors[0]
    }
    const byName = monitors.find((m) => m.name.toLowerCase().includes(normalized))
    if (byName) return byName
    return null
  }

  export async function getNativeMonitor(
    monitorId: number,
  ): Promise<InstanceType<typeof import("node-screenshots").Monitor> | null> {
    const { Monitor } = await import("node-screenshots")
    const monitors = Monitor.all()
    return monitors.find((m) => m.id() === monitorId) ?? null
  }

  export async function bind(query: string | number): Promise<MonitorBinding> {
    const info = await findMonitor(query)
    if (!info) {
      throw new Error(`No monitor found matching "${String(query)}"`)
    }
    state().binding = {
      monitorId: info.id,
      match: String(query),
      info,
    }
    log.info("bound monitor", { monitorId: info.id, name: info.name, isPrimary: info.isPrimary })
    return state().binding!
  }

  export function unbind(): void {
    log.info("unbound monitor", { previous: state().binding?.monitorId ?? null })
    state().binding = null
  }

  export async function getBinding(): Promise<MonitorBinding | null> {
    const binding = state().binding
    if (!binding) return null
    const current = await findMonitor(binding.monitorId)
    if (!current) {
      log.warn("bound monitor disappeared", { monitorId: binding.monitorId, match: binding.match })
      state().binding = null
      return null
    }
    state().binding = {
      monitorId: current.id,
      match: binding.match,
      info: current,
    }
    return state().binding
  }
}
