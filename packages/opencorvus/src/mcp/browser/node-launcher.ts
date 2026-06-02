import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { BROWSER_MCP_NODE_BUNDLE } from "./node-bundle.generated"

export namespace BrowserMCPNodeLauncher {
  export async function serveStdio() {
    const runtime = await resolveRuntime()
    const { node, bundle } = runtime
    const child = spawn(node, [bundle], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    })
    await new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        const code = (error as NodeJS.ErrnoException).code
        if (code === "ENOENT") {
          reject(new Error(`Browser MCP packaged Node runtime is missing. Tried: ${node}`))
          return
        }
        reject(error)
      })
      child.once("exit", (code, signal) => {
        if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") return resolve()
        reject(new Error(`browser MCP node process exited with ${signal ?? code}`))
      })
    })
  }

  export async function resolveRuntime(
    runtime: {
      execPath?: string
      platform?: NodeJS.Platform
    } = {},
  ) {
    const packaged = packagedRuntimePaths(runtime)
    if ((await exists(packaged.node)) && (await exists(packaged.bundle))) return packaged
    if (isBunRuntime(runtime.execPath ?? process.execPath)) {
      return {
        node: process.env.OPENCORVUS_BROWSER_MCP_NODE ?? nodeExecutableName(runtime.platform ?? process.platform),
        bundle: await resolveSourceBundle(),
      }
    }
    throw new Error(
      `Browser MCP packaged runtime is missing. Expected ${packaged.node} and ${packaged.bundle} beside the opencorvus executable.`,
    )
  }

  export function packagedRuntimePaths(
    runtime: {
      execPath?: string
      platform?: NodeJS.Platform
    } = {},
  ) {
    const execPath = runtime.execPath ?? process.execPath
    const platform = runtime.platform ?? process.platform
    const dir = path.join(path.dirname(execPath), "browser-mcp-node")
    return {
      node: path.join(dir, nodeExecutableName(platform)),
      bundle: path.join(dir, "stdio.mjs"),
    }
  }

  function nodeExecutableName(platform: NodeJS.Platform) {
    return platform === "win32" ? "node.exe" : "node"
  }

  function isBunRuntime(execPath: string) {
    const executable = path.basename(execPath).toLowerCase().replace(/\.exe$/, "")
    return executable === "bun"
  }

  async function resolveSourceBundle() {
    if (typeof BROWSER_MCP_NODE_BUNDLE === "string" && BROWSER_MCP_NODE_BUNDLE.length > 0) {
      const embedded = path.join(os.tmpdir(), "opencorvus-browser-mcp-node-embedded", "stdio.mjs")
      await fs.mkdir(path.dirname(embedded), { recursive: true })
      await fs.writeFile(embedded, BROWSER_MCP_NODE_BUNDLE)
      return embedded
    }
    return buildSourceBundle()
  }

  async function buildSourceBundle() {
    if (typeof Bun === "undefined") {
      throw new Error("Browser MCP node bundle is missing and this runtime cannot build it.")
    }
    const outdir = path.join(os.tmpdir(), "opencorvus-browser-mcp-node")
    await fs.mkdir(outdir, { recursive: true })
    const result = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "stdio.ts")],
      outdir,
      target: "node",
      external: ["electron"],
    })
    if (!result.success) {
      const detail = result.logs.map((item) => item.message).join("; ")
      throw new Error(`Failed to build Browser MCP node bundle: ${detail}`)
    }
    const js = path.join(outdir, "stdio.js")
    const mjs = path.join(outdir, "stdio.mjs")
    await fs.rename(js, mjs).catch(async () => {
      await fs.copyFile(js, mjs)
    })
    return mjs
  }

  async function exists(file: string) {
    return fs
      .access(file)
      .then(() => true)
      .catch(() => false)
  }
}
