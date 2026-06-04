import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  isBunExecutable,
  packagedBrowserNodeRuntimePaths,
  resolveBrowserNodeSidecarRuntime,
} from "@/browser/runtime/node-sidecar"

export namespace BrowserMCPNodeLauncher {
  export async function serveStdio() {
    await serve("stdio")
  }

  export async function serveHttp() {
    await serve("http")
  }

  async function serve(transport: "http" | "stdio") {
    const runtime = await resolveRuntime({ transport })
    const { node, bundle } = runtime
    const env = { ...process.env }
    if (runtime.packaged) {
      env.OPENCORVUS_BROWSER_MCP_PACKAGED = "1"
      delete env.OPENCORVUS_BROWSER_MCP_SOURCE_PACKAGE_DIR
    } else {
      env.OPENCORVUS_BROWSER_MCP_SOURCE_PACKAGE_DIR = path.resolve(import.meta.dir, "../../..")
      delete env.OPENCORVUS_BROWSER_MCP_PACKAGED
    }
    const child = spawn(node, [bundle], {
      cwd: process.cwd(),
      env,
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
        reject(new Error(`browser MCP node ${transport} process exited with ${signal ?? code}`))
      })
    })
  }

  export async function resolveRuntime(
    runtime: {
      execPath?: string
      platform?: NodeJS.Platform
      transport?: "http" | "stdio"
    } = {},
  ) {
    const packaged = packagedRuntimePaths(runtime)
    if ((await exists(packaged.node)) && (await exists(packaged.bundle))) return { ...packaged, packaged: true }
    if (isBunExecutable(runtime.execPath ?? process.execPath)) {
      const browserRuntime = await resolveBrowserNodeSidecarRuntime(runtime)
      return {
        node: browserRuntime.nodeExecutable,
        bundle: await resolveSourceBundle(runtime.transport ?? "stdio"),
        packaged: false,
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
      transport?: "http" | "stdio"
    } = {},
  ) {
    const packaged = packagedBrowserNodeRuntimePaths(runtime)
    const transport = runtime.transport ?? "stdio"
    return {
      node: packaged.nodeExecutable,
      bundle: transport === "http" ? packaged.mcpHttpBundle : packaged.mcpBundle,
    }
  }

  async function resolveSourceBundle(transport: "http" | "stdio") {
    return buildSourceBundle(transport)
  }

  async function buildSourceBundle(transport: "http" | "stdio") {
    if (typeof Bun === "undefined") {
      throw new Error("Browser MCP node bundle is missing and this runtime cannot build it.")
    }
    const outdir = path.join(os.tmpdir(), "opencorvus-browser-mcp-node")
    await fs.mkdir(outdir, { recursive: true })
    const entrypoint = `${transport}.ts`
    const result = await Bun.build({
      entrypoints: [path.join(import.meta.dir, entrypoint)],
      outdir,
      target: "node",
      external: ["electron"],
    })
    if (!result.success) {
      const detail = result.logs.map((item) => item.message).join("; ")
      throw new Error(`Failed to build Browser MCP node bundle: ${detail}`)
    }
    const js = path.join(outdir, `${transport}.js`)
    const mjs = path.join(outdir, `${transport}.mjs`)
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
