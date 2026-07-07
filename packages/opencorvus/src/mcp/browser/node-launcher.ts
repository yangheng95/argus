import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  isBunExecutable,
  packagedBrowserNodeRuntimePaths,
  resolveBrowserNodeSidecarRuntime,
} from "@/browser/runtime/node-sidecar"
import { ProcessSupervisor } from "@/shell/process-supervisor"

export namespace BrowserMCPNodeLauncher {
  const CHILD_CLEANUP_TIMEOUT_MS = 2_000

  export async function serveStdio() {
    await serve("stdio")
  }

  export async function serveHttp() {
    await serve("http")
  }

  async function serve(transport: "http" | "stdio") {
    const runtime = await resolveRuntime({ transport })
    const { node, bundle } = runtime
    const env = await childEnvironment({ packaged: runtime.packaged })
    const child = spawn(node, [bundle, transport], {
      ...childSpawnOptions({ env }),
    })
    let terminating = false
    const terminate = async (signal: NodeJS.Signals = "SIGTERM") => {
      if (terminating) return
      terminating = true
      await terminateChildTree(child, signal)
    }
    const sigint = () => {
      void terminate("SIGINT")
        .catch((error) => logLauncherError("SIGINT terminate failed", error))
        .finally(() => process.exit(130))
    }
    const sigterm = () => {
      void terminate("SIGTERM")
        .catch((error) => logLauncherError("SIGTERM terminate failed", error))
        .finally(() => process.exit(143))
    }
    const stdinClosed = () => {
      void terminate("SIGTERM")
        .catch((error) => {
          logLauncherError("stdin close terminate failed", error)
          process.exitCode = 1
        })
        .finally(() => {
          if (process.exitCode) process.exit(process.exitCode)
        })
    }
    process.once("SIGINT", sigint)
    process.once("SIGTERM", sigterm)
    process.stdin.once("close", stdinClosed)
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
        process.off("SIGINT", sigint)
        process.off("SIGTERM", sigterm)
        process.stdin.off("close", stdinClosed)
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
      bundle: packaged.mcpBundle,
    }
  }

  async function resolveSourceBundle(transport: "http" | "stdio") {
    return buildSourceBundle(transport)
  }

  export function childSpawnOptions(input: { env: NodeJS.ProcessEnv; platform?: NodeJS.Platform }): SpawnOptions {
    return {
      cwd: process.cwd(),
      env: input.env,
      stdio: "inherit",
      windowsHide: true,
      detached: (input.platform ?? process.platform) !== "win32",
    }
  }

  export async function childEnvironment(input: {
    packaged: boolean
    directory?: string
    env?: NodeJS.ProcessEnv
  }): Promise<NodeJS.ProcessEnv> {
    const env = { ...(input.env ?? process.env) }
    if (input.packaged) {
      env.OPENCORVUS_BROWSER_MCP_PACKAGED = "1"
      delete env.OPENCORVUS_BROWSER_MCP_SOURCE_PACKAGE_DIR
    } else {
      env.OPENCORVUS_BROWSER_MCP_SOURCE_PACKAGE_DIR = path.resolve(import.meta.dir, "../../..")
      delete env.OPENCORVUS_BROWSER_MCP_PACKAGED
    }

    return env
  }

  function processGroupIsRunning(pid: number): boolean {
    try {
      process.kill(-pid, 0)
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ESRCH") return false
      return code === "EPERM"
    }
  }

  function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return
      throw error
    }
  }

  async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!processGroupIsRunning(pid)) return true
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return !processGroupIsRunning(pid)
  }

  async function terminateChildTree(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
    const pid = child.pid
    if (!pid) return
    if (process.platform === "win32") {
      await ProcessSupervisor.terminateProcessTree(pid, `browser MCP node process tree ${pid}`)
      return
    }
    signalProcessGroup(pid, signal)
    if (await waitForProcessGroupExit(pid, CHILD_CLEANUP_TIMEOUT_MS)) return
    try {
      signalProcessGroup(pid, "SIGKILL")
    } catch (error) {
      logLauncherError("process group force kill failed", error)
    }
    if (await waitForProcessGroupExit(pid, CHILD_CLEANUP_TIMEOUT_MS)) {
      return
    }
    throw new Error(`browser MCP node process ${pid} did not exit after SIGKILL within ${CHILD_CLEANUP_TIMEOUT_MS}ms`)
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
    await fs.rename(js, mjs)
    return mjs
  }

  async function exists(file: string) {
    return fs
      .access(file)
      .then(() => true)
      .catch(() => false)
  }

  function logLauncherError(message: string, error: unknown) {
    console.error(`[browser-mcp-launcher] ${message}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
