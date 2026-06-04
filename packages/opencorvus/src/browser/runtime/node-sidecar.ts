import { createRequire } from "node:module"
import fs from "node:fs/promises"
import path from "node:path"

export interface BrowserNodeSidecarRuntime {
  nodeExecutable: string
  playwrightRequirePath: string
  packaged: boolean
}

export function packagedBrowserNodeRuntimePaths(input: {
  execPath?: string
  platform?: NodeJS.Platform
} = {}) {
  const execPath = input.execPath ?? process.execPath
  const platform = input.platform ?? process.platform
  const dir = path.join(path.dirname(execPath), "browser-mcp-node")
  return {
    nodeExecutable: path.join(dir, browserNodeExecutableName(platform)),
    playwrightRequirePath: path.join(dir, "node_modules", "playwright", "index.js"),
    mcpBundle: path.join(dir, "stdio.mjs"),
    mcpHttpBundle: path.join(dir, "http.mjs"),
  }
}

export async function resolveBrowserNodeSidecarRuntime(input: {
  execPath?: string
  platform?: NodeJS.Platform
} = {}): Promise<BrowserNodeSidecarRuntime> {
  const platform = input.platform ?? process.platform
  const packaged = packagedBrowserNodeRuntimePaths(input)
  if ((await exists(packaged.nodeExecutable)) && (await exists(packaged.playwrightRequirePath))) {
    return {
      nodeExecutable: packaged.nodeExecutable,
      playwrightRequirePath: packaged.playwrightRequirePath,
      packaged: true,
    }
  }

  if (isBunExecutable(input.execPath ?? process.execPath)) {
    return {
      nodeExecutable: process.env.OPENCORVUS_BROWSER_MCP_NODE ?? browserNodeExecutableName(platform),
      playwrightRequirePath: createRequire(import.meta.url).resolve("playwright"),
      packaged: false,
    }
  }

  throw new Error(
    `Browser Node sidecar runtime is missing. Expected ${packaged.nodeExecutable} and ${packaged.playwrightRequirePath} beside the opencorvus executable.`,
  )
}

export function browserNodeExecutableName(platform: NodeJS.Platform) {
  return platform === "win32" ? "node.exe" : "node"
}

export function isBunExecutable(execPath: string) {
  const executable = path.basename(execPath).toLowerCase().replace(/\.exe$/, "")
  return executable === "bun"
}

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}
