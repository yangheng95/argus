import path from "node:path"
import { computerRuntimeWorkspace } from "./runtime-scope"

export namespace ComputerMCPBuiltin {
  export const ServerName = "computer"

  const ToolNames = [
    "session_create",
    "observe",
    "click",
    "type_text",
    "keypress",
    "scroll",
    "drag",
    "session_destroy",
  ] as const

  export type ToolName = (typeof ToolNames)[number]
  export const ImportableToolNames = Object.freeze([...ToolNames])
  export const ImportableToolRefs = Object.freeze(ToolNames.map((name) => `default/mcp/${ServerName}/tool/${name}`))
  export const ScreenshotEvidenceToolRefs = Object.freeze([`default/mcp/${ServerName}/tool/observe`])

  export function command(
    runtime: {
      execPath?: string
      moduleDir?: string
    } = {},
  ) {
    const execPath = runtime.execPath ?? process.execPath
    const moduleDir = runtime.moduleDir ?? import.meta.dir
    const args = isBunRuntime(execPath) ? [path.resolve(moduleDir, "stdio.ts")] : ["mcp", "computer"]
    return [execPath, ...args]
  }

  export function localConfig(
    runtime: {
      execPath?: string
      moduleDir?: string
      runtimeBundleManifest?: string
      runtimeScope?: string
      hostAdapter?: { endpoint: string; authorization: string; runtimeScope: string }
    } = {},
  ) {
    const environment = {
      ...(!runtime.hostAdapter && runtime.runtimeBundleManifest
        ? { OPENCORVUS_COMPUTER_RUNTIME_MANIFEST: runtime.runtimeBundleManifest }
        : {}),
      ...(!runtime.hostAdapter && runtime.runtimeScope
        ? { OPENCORVUS_COMPUTER_WORKSPACE: computerRuntimeWorkspace(runtime.runtimeScope) }
        : {}),
      ...(runtime.hostAdapter
        ? {
            OPENCORVUS_COMPUTER_HOST_ENDPOINT: runtime.hostAdapter.endpoint,
            OPENCORVUS_COMPUTER_HOST_AUTHORIZATION: runtime.hostAdapter.authorization,
            OPENCORVUS_COMPUTER_RUNTIME_SCOPE: runtime.hostAdapter.runtimeScope,
          }
        : {}),
    }
    return {
      type: "local" as const,
      command: command(runtime),
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
      timeout: 30_000,
    }
  }

  export function withRuntimeScope<T extends { type: "local"; environment?: Record<string, string> }>(
    mcp: T,
    runtimeScope: string,
    hostAdapter: { endpoint: string; authorization: string; runtimeScope: string },
  ): T {
    const adapterEnvironment = { ...mcp.environment }
    delete adapterEnvironment.OPENCORVUS_COMPUTER_RUNTIME_MANIFEST
    delete adapterEnvironment.OPENCORVUS_COMPUTER_WORKSPACE
    return {
      ...mcp,
      environment: {
        ...adapterEnvironment,
        OPENCORVUS_COMPUTER_HOST_ENDPOINT: hostAdapter.endpoint,
        OPENCORVUS_COMPUTER_HOST_AUTHORIZATION: hostAdapter.authorization,
        OPENCORVUS_COMPUTER_RUNTIME_SCOPE: runtimeScope,
      },
    }
  }
}

function isBunRuntime(execPath: string) {
  return (
    path
      .basename(execPath)
      .toLowerCase()
      .replace(/\.exe$/, "") === "bun"
  )
}
