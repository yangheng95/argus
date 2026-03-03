import { Server } from "../../server/server"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import { Workspace } from "../../control-plane/workspace"
import { Project } from "../../project/project"
import { Installation } from "../../installation"
import { startOverlay } from "../../tool/overlay-client"

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

export const ServeCommand = cmd({
  command: ["serve", "$0"],
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
