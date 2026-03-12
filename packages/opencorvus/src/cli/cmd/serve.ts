import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { createConnection } from "net"

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
  } catch {
    /* best-effort cosmetic: hiding the console window is non-critical */
  }
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
    } catch {
      /* fuser may not be installed; safe to ignore since port release is retried */
    }
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
  } catch {
    /* best-effort cleanup: netstat/taskkill may fail; caller retries port availability */
  }
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("project-dir", {
      type: "string",
      describe: "default project directory for all task operations (sandbox)",
    }),
  describe: "starts a headless opencorvus server",
  handler: async (args) => {
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
    const projectDir = (args as Record<string, unknown>)["project-dir"] as string | undefined || process.env.OPENCORVUS_PROJECT_DIR || undefined
    if (projectDir) {
      const resolved = require("path").resolve(projectDir)
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
    console.log(`opencorvus server listening on http://${server.hostname}:${server.port}`)
    console.log(`overlay UI available at http://${server.hostname}:${server.port}/ui/`)

    // Only available in development right now
    if (Installation.isLocal()) {
      for (const project of Project.list()) {
        Workspace.startSyncing(project)
      }
    }

    // Block forever — server runs until process is killed.
    await new Promise(() => {})
  },
})
