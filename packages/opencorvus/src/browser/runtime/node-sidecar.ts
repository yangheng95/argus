import { createRequire } from "node:module"
import fs from "node:fs/promises"
import path from "node:path"

export interface BrowserNodeSidecarRuntime {
  nodeExecutable: string
  playwrightRequirePath: string
  packaged: boolean
}

export async function resolveBrowserNodeSidecarRuntime(input: {
  execPath?: string
  platform?: NodeJS.Platform
} = {}): Promise<BrowserNodeSidecarRuntime> {
  const platform = input.platform ?? process.platform
  const packagedDir = path.join(path.dirname(input.execPath ?? process.execPath), "browser-mcp-node")
  const packagedNode = path.join(packagedDir, nodeExecutableName(platform))
  const packagedPlaywright = path.join(packagedDir, "node_modules", "playwright", "index.js")
  if ((await exists(packagedNode)) && (await exists(packagedPlaywright))) {
    return {
      nodeExecutable: packagedNode,
      playwrightRequirePath: packagedPlaywright,
      packaged: true,
    }
  }

  if (isBunRuntime(input.execPath ?? process.execPath)) {
    return {
      nodeExecutable: process.env.OPENCORVUS_BROWSER_MCP_NODE ?? nodeExecutableName(platform),
      playwrightRequirePath: createRequire(import.meta.url).resolve("playwright"),
      packaged: false,
    }
  }

  throw new Error(
    `Browser Node sidecar runtime is missing. Expected ${packagedNode} and ${packagedPlaywright} beside the opencorvus executable.`,
  )
}

function nodeExecutableName(platform: NodeJS.Platform) {
  return platform === "win32" ? "node.exe" : "node"
}

function isBunRuntime(execPath: string) {
  const executable = path.basename(execPath).toLowerCase().replace(/\.exe$/, "")
  return executable === "bun"
}

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}
