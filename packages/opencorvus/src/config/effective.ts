import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { SessionContext } from "@/session/context"

export namespace EffectiveConfig {
  export const TASK_SNAPSHOT_KEY = "taskConfigSnapshot"

  export async function snapshotCurrent(): Promise<Config.Info> {
    return structuredClone(await Config.get()) as Config.Info
  }

  export async function base(opts?: { taskID?: string; sessionID?: string }): Promise<Config.Info> {
    if (!opts?.taskID && !opts?.sessionID) {
      const ambient = SessionContext.tryUse()
      if (ambient && !ambient.parentID) {
        const snapshot = ambient.metadata?.[TASK_SNAPSHOT_KEY]
        if (snapshot !== undefined) return Config.Info.parse(snapshot)
        return Config.get()
      }
    }

    const sessionID = await rootSessionID(opts)
    if (!sessionID) return Config.get()

    const { Session } = await import("@/session")
    const session = await Session.get(sessionID)
    const snapshot = session.metadata?.[TASK_SNAPSHOT_KEY]
    if (snapshot !== undefined) return Config.Info.parse(snapshot)

    return Instance.provide({
      directory: session.directory,
      fn: () => Config.get(),
    })
  }

  export async function effective(opts?: { taskID?: string; sessionID?: string }): Promise<Config.Info> {
    const [baseConfig, overlay] = await Promise.all([
      base(opts),
      resolveOverlay(opts),
    ])
    return Config.mergeOverlay(baseConfig, overlay ?? {})
  }

  async function resolveOverlay(opts?: { taskID?: string; sessionID?: string }): Promise<Config.Overlay | undefined> {
    const { resolveSessionOverlay } = await import("@/agent/model")
    return resolveSessionOverlay(opts)
  }

  async function rootSessionID(opts?: { taskID?: string; sessionID?: string }): Promise<string | undefined> {
    if (opts?.taskID) {
      const { requireTask } = await import("@/engine/store")
      return requireTask(opts.taskID).session_id ?? undefined
    }
    if (opts?.sessionID) return resolveRootSessionID(opts.sessionID)

    const ambient = SessionContext.tryUse()
    if (!ambient) return undefined
    if (!ambient.parentID) return ambient.id
    return resolveRootSessionID(ambient.id)
  }

  async function resolveRootSessionID(sessionID: string): Promise<string> {
    const { Session } = await import("@/session")
    let current = await Session.get(sessionID)
    for (let hops = 0; current.parentID && hops < 64; hops++) {
      current = await Session.get(current.parentID)
    }
    return current.id
  }
}
