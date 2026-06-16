import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions, type NetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { createConnection } from "net"
import { clearServerShutdownHandler, registerServerShutdownHandler } from "../../server/shutdown"
import { closeBrowserPreviewLiveSessions } from "../../browser-preview/live"
import type { ArgumentsCamelCase } from "yargs"

/** Hide the console window on Windows using Win32 API. */
function hideConsoleWindow() {
  if (process.platform !== "win32") return
  try {
    const { dlopen, FFIType } = require("bun:ffi")
    const kernel32 = dlopen("kernel32.dll", {
      GetConsoleWindow: { returns: FFIType.ptr, args: [] },
    })
    const user32 = dlopen("user32.dll", {
      ShowWindow: { returns: FFIType.i32, args: [FFIType.ptr, FFIType.i32] },
    })
    const hwnd = kernel32.symbols.GetConsoleWindow()
    if (hwnd) user32.symbols.ShowWindow(hwnd, 0) // SW_HIDE
    kernel32.close()
    user32.close()
  } catch {}
}

/** Check if a port is in use. */
function isPortInUse(port: number, hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: hostname })
    sock.once("connect", () => {
      sock.destroy()
      resolve(true)
    })
    sock.once("error", () => resolve(false))
    sock.setTimeout(500, () => {
      sock.destroy()
      resolve(false)
    })
  })
}

/** Kill old opencorvus process occupying the port. */
async function killOldProcess(port: number) {
  if (process.platform !== "win32") {
    // Unix: use fuser
    try {
      Bun.spawnSync(["fuser", "-k", `${port}/tcp`], { stdio: ["ignore", "ignore", "ignore"] })
    } catch {}
    return
  }
  // Windows: netstat → find PID → taskkill
  try {
    const result = Bun.spawnSync(["cmd", "/c", `netstat -ano | findstr :${port} | findstr LISTENING`], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const output = result.stdout.toString()
    const pids = new Set<number>()
    for (const line of output.split(/\r?\n/)) {
      const match = line.trim().match(/\s(\d+)\s*$/)
      if (match) pids.add(Number(match[1]))
    }
    for (const pid of pids) {
      if (pid === process.pid || pid <= 0) continue
      Bun.spawnSync(["taskkill", "/F", "/PID", String(pid)], { stdio: ["ignore", "ignore", "ignore"] })
    }
  } catch {}
}

type ServeOptions = NetworkOptions & { "project-dir"?: string }

const serveBuilder = (yargs: Parameters<typeof withNetworkOptions>[0]) =>
  withNetworkOptions(yargs).option("project-dir", {
    type: "string",
    describe: "default project directory for all task operations (sandbox)",
  })

export async function handleServeCommand(args: ArgumentsCamelCase<ServeOptions>) {
  // When launched as default entry (double-click), hide console window
  const isDefaultMode = !process.argv.slice(2).some((a) => a === "serve")
  if (isDefaultMode) {
    hideConsoleWindow()
  }

  if (!Flag.OPENCORVUS_SERVER_PASSWORD) {
    console.log("Warning: OPENCORVUS_SERVER_PASSWORD is not set; server is unsecured.")
  }
  const opts = await resolveNetworkOptions(args)

  // Resolve --project-dir: CLI arg > env var > process.cwd()
  const projectDir = (args as any)["project-dir"] || process.env.OPENCORVUS_PROJECT_DIR || undefined
  if (projectDir) {
    const resolved = require("path").resolve(projectDir)
    process.env.OPENCORVUS_PROJECT_DIR = resolved
    console.log(`Project directory (sandbox): ${resolved}`)
  }

  // Kill old process if port is occupied, then wait for release with retries
  if (opts.port > 0 && (await isPortInUse(opts.port, opts.hostname))) {
    console.log(`Port ${opts.port} is in use, killing old process...`)
    await killOldProcess(opts.port)
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (!(await isPortInUse(opts.port, opts.hostname))) break
    }
  }

  process.on("uncaughtException", (err) => {
    console.error("[serve] uncaughtException:", err)
  })
  process.on("unhandledRejection", (err) => {
    console.error("[serve] unhandledRejection:", err)
  })

  const server = Server.listen(opts)
  const serverUrl = `http://${server.hostname}:${server.port}`
  // Publish actual server URL so ChannelSupervisor can connect channel runtime to it
  process.env.OPENCORVUS_SERVER_URL = serverUrl
  console.log(`opencorvus server listening on ${serverUrl}`)
  console.log(`overlay UI available at ${serverUrl}/ui/`)
  try {
    const { convergeDeadOwnerLiveExecution } = await import("../../engine/writer")
    const converged = await convergeDeadOwnerLiveExecution({
      reason: "Server startup: previous owner process died before terminalization",
    })
    if (
      converged.tasks > 0 ||
      converged.goalRuns > 0 ||
      converged.runs > 0 ||
      converged.sessions > 0 ||
      converged.toolParts > 0 ||
      converged.corruptTasks > 0
    ) {
      console.log(
        `[serve] converged dead-owner execution tasks=${converged.tasks} runs=${converged.runs} goalRuns=${converged.goalRuns} sessions=${converged.sessions} toolParts=${converged.toolParts} corruptTasks=${converged.corruptTasks}`,
      )
    }
  } catch (error) {
    console.error("[serve] startup owner-death convergence failed:", error)
  }

  let shutdownPromise: Promise<void> | null = null
  const requestShutdown = (trigger: string) => {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      const reason = `Server shutdown: ${trigger}`
      console.log(`[serve] shutdown requested via ${trigger}`)
      try {
        const { abortCurrentProcessLiveExecution } = await import("../../engine/writer")
        const aborted = await abortCurrentProcessLiveExecution({ reason })
        console.log(
          `[serve] aborted live execution tasks=${aborted.tasks} runs=${aborted.runs} goalRuns=${aborted.goalRuns} ownerships=${aborted.ownerships} sessions=${aborted.sessions} toolParts=${aborted.toolParts} corruptTasks=${aborted.corruptTasks}`,
        )
      } catch (error) {
        console.error("[serve] graceful shutdown abort failed:", error)
      }
      try {
        await closeBrowserPreviewLiveSessions()
      } catch (error) {
        console.error("[serve] browser preview shutdown failed:", error)
      }
      try {
        await server.stop(true)
      } catch (error) {
        console.error("[serve] server.stop failed during shutdown:", error)
      }
    })().finally(() => {
      clearServerShutdownHandler(requestShutdown)
      setTimeout(() => process.exit(0), 0)
    })
    return shutdownPromise
  }
  registerServerShutdownHandler(requestShutdown)

  const signals: NodeJS.Signals[] =
    process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"]
  for (const signal of signals) {
    process.on(signal, () => {
      void requestShutdown(signal)
    })
  }

  await new Promise(() => {})
}

export const DefaultServeCommand = cmd({
  command: "$0",
  builder: serveBuilder,
  describe: false,
  handler: handleServeCommand,
})

export const ServeCommand = cmd({
  command: "serve",
  builder: serveBuilder,
  describe: "starts a headless opencorvus server",
  handler: handleServeCommand,
})
