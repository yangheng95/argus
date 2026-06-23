import path from "path"
import { Server } from "../../server/server"
import { SidecarLock } from "../../server/sidecar-lock"
import { ParentWatchdog } from "../../server/parent-watchdog"
import { clearServerShutdownHandler, registerServerShutdownHandler } from "../../server/shutdown"
import { stopServerWithTimeout } from "../../server/stop"
import { cmd } from "./cmd"
import { Log } from "../../util/log"

/**
 * Managed sidecar subcommand for VS Code extension host integration.
 *
 * Hard differences from `opencorvus serve`:
 *  - Always random OS-assigned port (no DEFAULT_SERVER_PORT trial).
 *  - Bound to 127.0.0.1 only.
 *  - Token (OPENCORVUS_SERVER_PASSWORD) required up-front; missing → exit.
 *  - Token cleared from process.env after readout so spawned children
 *    (LLM tools, sub-agents) don't inherit it (§19.1.3).
 *  - Parent PID required up-front; if parent dies, watchdog self-kills
 *    the sidecar (§19.1.2).
 *  - Workspace-scoped lock prevents two managed sidecars on the same
 *    workspace (§19.1.1, partial — non-managed daemons not detected here).
 *  - Stdout handshake `OPENCORVUS_LISTEN=127.0.0.1:<port>` is the ONLY
 *    way the parent extension learns the actual port.
 *  - Never kills processes occupying ports.
 *  - mDNS disabled.
 */
export const SidecarCommand = cmd({
  command: "sidecar",
  describe: "headless managed sidecar for vscode-extension (internal use)",
  builder: (yargs) =>
    yargs
      .option("project-dir", {
        type: "string",
        describe: "workspace root (required)",
        demandOption: true,
      })
      .option("parent-pid", {
        type: "number",
        describe: "parent extension host PID (required); sidecar self-exits if parent dies",
      })
      .option("watchdog-interval-ms", {
        type: "number",
        describe: "parent-pid watchdog polling interval",
        default: 5000,
      }),
  handler: async (args) => {
    const log = Log.create({ service: "sidecar" })

    // 1. Resolve workspace and validate parent PID.
    const workspace = path.resolve(args["project-dir"] as string)
    const parentPid = (args["parent-pid"] as number | undefined) ?? Number(process.env.OPENCORVUS_PARENT_PID)
    if (!Number.isInteger(parentPid) || parentPid <= 0) {
      console.error(
        "[sidecar] OPENCORVUS_PARENT_PID env or --parent-pid flag is required and must be a positive integer",
      )
      process.exit(2)
    }

    // 2. Token required and immediately cleared from env (§19.1.3).
    const token = process.env.OPENCORVUS_SERVER_PASSWORD
    if (!token) {
      console.error("[sidecar] OPENCORVUS_SERVER_PASSWORD is required for managed sidecar mode")
      process.exit(2)
    }
    // Hold reference for our own auth middleware before we clear env.
    // Auth middleware reads Flag.OPENCORVUS_SERVER_PASSWORD which was
    // captured at module-load time, so clearing env now does NOT affect
    // our own auth, only future child processes.
    delete process.env.OPENCORVUS_SERVER_PASSWORD

    // 3. Detect existing managed sidecar on the same workspace.
    const existing = SidecarLock.detectExisting(workspace)
    if (existing) {
      console.error(
        `[sidecar] existing managed sidecar detected (PID=${existing.pid}, port=${existing.port}). ` +
          `Stop it before opening this workspace in VS Code.`,
      )
      process.exit(3)
    }

    // 4. Start the server (random port, 127.0.0.1, no mDNS).
    const server = Server.listen({
      port: 0,
      hostname: "127.0.0.1",
      randomPort: true,
      mdns: false,
      cors: [],
    })
    const port = server.port!
    const url = `http://127.0.0.1:${port}`

    // 5. Acquire lock with concrete port. audit-2026-04-29 opencorvus F2 —
    //    even after the pre-check, two sidecars may race the write.
    //    `acquire` uses O_EXCL so the loser throws SidecarLockContendedError;
    //    we map it to exit-3 with the same stderr shape so the
    //    extension's TransportBridge -> SidecarExistingInstanceError
    //    flow handles both detect-time and race-time contention identically.
    let lock: ReturnType<typeof SidecarLock.acquire>
    try {
      lock = SidecarLock.acquire({
        pid: process.pid,
        port,
        hostname: "127.0.0.1",
        parentPid,
        workspace,
        startedAt: Date.now(),
      })
    } catch (err) {
      try {
        await server.stop(true)
      } catch {}
      if (err instanceof SidecarLock.SidecarLockContendedError) {
        console.error(`[sidecar] ${err.message}. Stop it before opening this workspace in VS Code.`)
        process.exit(3)
      }
      throw err
    }

    // 6. Publish actual server URL for in-process channel runtime
    //    consumers (e.g. ChannelSupervisor); does NOT affect parent.
    process.env.OPENCORVUS_SERVER_URL = url

    // 7. STDOUT handshake — parent extension parses this single line.
    //    Must come AFTER listen succeeds so the port is final.
    process.stdout.write(`OPENCORVUS_LISTEN=127.0.0.1:${port}\n`)

    log.info("ready", { port, workspace, parentPid })

    // 8. Wire shutdown handler.
    let shutdownPromise: Promise<void> | null = null
    let watchdog: { stop: () => void } | undefined
    const requestShutdown = (trigger: string) => {
      if (shutdownPromise) return shutdownPromise
      shutdownPromise = (async () => {
        log.info("shutdown requested", { trigger })
        try {
          watchdog?.stop()
        } catch {}
        // audit-2026-04-29 opencorvus F3 — release the lock AFTER
        // server.stop. If we release first and stop hangs (SSE long
        // poll, buggy handler), the workspace lock is gone but the
        // port is still bound; a parallel sidecar boot would pass
        // detectExisting and end up with two live processes serving
        // the same DB, which is exactly the §19.1.1 failure.
        // Cap stop with a hard timeout so a hung server can't
        // indefinitely hold the lock either.
        const STOP_TIMEOUT_MILLISECONDS = 5000
        await stopServerWithTimeout({
          stop: () => server.stop(true),
          timeoutMilliseconds: STOP_TIMEOUT_MILLISECONDS,
          onStopError: (error) => {
            log.error("server.stop failed", { error: String(error) })
          },
          onTimeout: () => {
            log.error("server.stop timeout, escalating", { ms: STOP_TIMEOUT_MILLISECONDS })
          },
        })
        try {
          lock.release()
        } catch {}
      })().finally(() => {
        clearServerShutdownHandler(requestShutdown)
        setTimeout(() => process.exit(0), 0)
      })
      return shutdownPromise
    }
    registerServerShutdownHandler(requestShutdown)

    // 9. Parent-PID watchdog (§19.1.2).
    watchdog = ParentWatchdog.start({
      parentPid,
      intervalMs: (args["watchdog-interval-ms"] as number) || 5000,
      onOrphan: (reason) => {
        void requestShutdown(reason)
      },
    })

    // 10. POSIX signals.
    const signals: NodeJS.Signals[] =
      process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"]
    for (const signal of signals) {
      process.on(signal, () => {
        void requestShutdown(signal)
      })
    }

    // 11. Block forever until a shutdown trigger fires.
    await new Promise(() => {})
  },
})
