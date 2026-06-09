import path from "path"

export namespace BrowserMCPBuiltin {
  export const ServerName = "browser"

  export function command(
    runtime: {
      execPath?: string
      moduleDir?: string
    } = {},
  ) {
    const execPath = runtime.execPath ?? process.execPath
    const moduleDir = runtime.moduleDir ?? import.meta.dir
    const args = isBunRuntime(execPath) ? [path.resolve(moduleDir, "node-stdio.ts")] : ["mcp", "browser"]

    return [execPath, ...args]
  }

  export function localConfig(
    runtime: {
      execPath?: string
      moduleDir?: string
    } = {},
  ) {
    return {
      type: "local" as const,
      command: command(runtime),
      timeout: 30_000,
    }
  }
}

function isBunRuntime(execPath: string) {
  const executable = path
    .basename(execPath)
    .toLowerCase()
    .replace(/\.exe$/, "")
  return executable === "bun"
}
