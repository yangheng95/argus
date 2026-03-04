import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { startOverlay } from "../../tool/overlay-client"
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

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencorvus server",
  handler: async (args) => {
    // When launched as default entry (double-click), hide console and start overlay
    const isDefaultMode = !process.argv.slice(2).some((a) => a === "serve")
    if (isDefaultMode) {
      hideConsoleWindow()
    }

    if (!Flag.OPENCORVUS_SERVER_PASSWORD) {
      console.log("Warning: OPENCORVUS_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)

    // Kill old process if port is occupied, then wait for release with retries
    if (opts.port > 0 && (await isPortInUse(opts.port, opts.hostname))) {
      console.log(`Port ${opts.port} is in use, killing old process...`)
      await killOldProcess(opts.port)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500))
        if (!(await isPortInUse(opts.port, opts.hostname))) break
      }
    }

    const server = Server.listen(opts)
    console.log(`opencorvus server listening on http://${server.hostname}:${server.port}`)

    // Start overlay GUI immediately in default mode
    if (isDefaultMode) {
      startOverlay()
    }

    let workspaceSync: Array<ReturnType<typeof Workspace.startSyncing>> = []
    // Only available in development right now
    if (Installation.isLocal()) {
      workspaceSync = Project.list().map((project) => Workspace.startSyncing(project))
    }

    await new Promise(() => {})
    await server.stop()
    await Promise.all(workspaceSync.map((item) => item.stop()))
  },
})
