import { spawn as nodeSpawn, execSync } from "child_process"
import net from "net"
import fs from "fs"
import os from "os"
import path from "path"
import type { ChildProcess } from "child_process"

export namespace Tui {
  export interface SpawnOptions {
    /** Working directory for the TUI process (defaults to process.cwd()) */
    directory?: string
    /** Session ID to continue */
    sessionID?: string
    /** Model to use (provider/model format) */
    model?: string
    /** Agent to use */
    agent?: string
    /** Initial prompt text */
    prompt?: string
    /** Continue last session */
    continue?: boolean
    /** Fork session when continuing */
    fork?: boolean
    /** Port for the TUI HTTP server (0 = auto-allocate) */
    port?: number
    /** Hostname for the TUI HTTP server (defaults to 127.0.0.1) */
    hostname?: string
    /** opencorvus executable path */
    bin?: string
  }

  export interface ConnectOptions {
    // reserved for future auth options (e.g. password)
  }

  export interface EmbeddedCommand {
    command: string
    args: string[]
    cwd: string
    url: string
    port: number
    hostname: string
    env?: Record<string, string>
  }

  export class Handle {
    readonly url: string
    private proc: ChildProcess | undefined
    private _closed = false

    constructor(url: string, proc?: ChildProcess) {
      this.url = url
      this.proc = proc
      if (proc) {
        proc.on("exit", () => {
          this._closed = true
        })
      }
    }

    get closed(): boolean {
      return this._closed
    }

    private async post(path: string, body?: unknown): Promise<void> {
      const res = await fetch(`${this.url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error(`TUI request failed: ${res.status} ${path}`)
    }

    /** Append text to the TUI prompt input */
    async appendPrompt(text: string): Promise<void> {
      await this.post("/tui/append-prompt", { text })
    }

    /** Submit the current TUI prompt */
    async submitPrompt(): Promise<void> {
      await this.post("/tui/submit-prompt", {})
    }

    /** Clear the current TUI prompt */
    async clearPrompt(): Promise<void> {
      await this.post("/tui/clear-prompt", {})
    }

    /** Navigate the TUI to a specific session */
    async selectSession(sessionID: string): Promise<void> {
      await this.post("/tui/select-session", { sessionID })
    }

    /** Execute a named TUI command (e.g. "agent_cycle", "session_new") */
    async executeCommand(command: string): Promise<void> {
      await this.post("/tui/execute-command", { command })
    }

    /** Show a toast notification in the TUI */
    async showToast(message: string, variant: "info" | "success" | "warning" | "error" = "info"): Promise<void> {
      await this.post("/tui/show-toast", { message, variant })
    }

    /** Open the help dialog */
    async openHelp(): Promise<void> {
      await this.post("/tui/open-help", {})
    }

    /** Open the sessions list dialog */
    async openSessions(): Promise<void> {
      await this.post("/tui/open-sessions", {})
    }

    /** Open the themes dialog */
    async openThemes(): Promise<void> {
      await this.post("/tui/open-themes", {})
    }

    /** Open the models dialog */
    async openModels(): Promise<void> {
      await this.post("/tui/open-models", {})
    }

    /** Send SIGTERM to the TUI process (no-op for connect()-created handles) */
    async close(): Promise<void> {
      this._closed = true
      this.proc?.kill("SIGTERM")
    }

    /**
     * Wait for the TUI process to exit and return its exit code.
     * Returns null immediately for connect()-created handles (no owned process).
     */
    waitForExit(): Promise<number | null> {
      if (!this.proc) return Promise.resolve(null)
      return new Promise<number | null>((resolve, reject) => {
        this.proc!.on("exit", (code) => resolve(code))
        this.proc!.on("error", reject)
      })
    }
  }

  function allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address() as net.AddressInfo
        srv.close(() => resolve(addr.port))
      })
      srv.on("error", reject)
    })
  }

  async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1000) })
        // Any response (even 404) means the HTTP server is up
        if (res.status < 500) return
      } catch {
        // Connection refused — server not up yet
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`TUI server did not become ready within ${timeoutMs}ms at ${url}`)
  }

  /**
   * Spawn a new TUI subprocess, wait until its HTTP server is ready, and return a Handle.
   *
   * The TUI inherits the parent's stdio so it renders in the same terminal.
   */
  /** Detect if we are running in dev mode (bun + source tree) rather than a compiled binary. */
  function isDevMode(): boolean {
    // In dev mode, import.meta.dir points into the source tree
    try {
      return (
        import.meta.dir.includes("packages/opencorvus/src") || import.meta.dir.includes("packages\\opencorvus\\src")
      )
    } catch {
      return false
    }
  }

  /** Resolve the opencorvus package root (two levels up from src/tui/). */
  function packageRoot(): string {
    // import.meta.dir = .../packages/opencorvus/src/tui
    return import.meta.dir.replace(/[/\\]src[/\\]tui$/, "")
  }

  /** Find an available terminal emulator on Linux. */
  function findLinuxTerminal(): string | undefined {
    const terminals = [
      "gnome-terminal",
      "konsole",
      "xfce4-terminal",
      "mate-terminal",
      "tilix",
      "alacritty",
      "kitty",
      "wezterm",
      "foot",
      "xterm",
      "lxterminal",
      "sakura",
      "terminator",
    ]
    for (const t of terminals) {
      try {
        execSync(`which ${t}`, { stdio: "ignore" })
        return t
      } catch {
        // not found
      }
    }
    return undefined
  }

  /** Build terminal-specific args to run a script in a new window. */
  function linuxTerminalArgs(terminal: string, title: string, script: string): string[] {
    switch (terminal) {
      case "gnome-terminal":
        return ["--title", title, "--", script]
      case "konsole":
        return ["--new-tab", "-p", `tabtitle=${title}`, "-e", script]
      case "xfce4-terminal":
      case "mate-terminal":
      case "tilix":
      case "terminator":
        return ["--title", title, "-e", script]
      case "alacritty":
        return ["--title", title, "-e", script]
      case "kitty":
        return ["--title", title, script]
      case "wezterm":
        return ["start", "--", script]
      case "foot":
        return ["--title", title, script]
      case "xterm":
        return ["-title", title, "-e", script]
      case "lxterminal":
      case "sakura":
        return ["--title", title, "-e", script]
      default:
        return ["-e", script]
    }
  }

  function selfBin(): string | undefined {
    const name = path.basename(process.execPath).toLowerCase()
    if (isOverlayServerExecutable()) return undefined
    if (name === "opencorvus" || name === "opencorvus.exe") return process.execPath
    return undefined
  }

  function siblingTuiBin(): string | undefined {
    const file = process.platform === "win32" ? "opencorvus-tui.exe" : "opencorvus-tui"
    const candidate = path.join(path.dirname(process.execPath), file)
    return fs.existsSync(candidate) ? candidate : undefined
  }

  function isOverlayServerExecutable(): boolean {
    try {
      const packagePath = path.join(path.dirname(process.execPath), "package.json")
      const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { name?: unknown }
      return typeof parsed.name === "string" && parsed.name.includes("overlay-server")
    } catch {
      return false
    }
  }

  async function resolveSpawn(opts: SpawnOptions = {}) {
    const port = opts.port ?? (await allocatePort())
    const hostname = opts.hostname ?? "127.0.0.1"
    const explicitBin = opts.bin ?? process.env.OPENCORVUS_BIN_PATH
    const cwd = opts.directory ?? process.cwd()
    const devMode = isDevMode() && !explicitBin
    const resolvedBin = explicitBin ?? siblingTuiBin() ?? selfBin()
    if (!devMode && !resolvedBin) {
      throw new Error(
        "Embedded TUI cannot resolve the current opencorvus executable. Start OpenCorvus from the source dev command or set OPENCORVUS_BIN_PATH; refusing to use a PATH fallback.",
      )
    }
    const bin = resolvedBin ?? ""

    // Pass directory as positional arg to trigger TUI mode (not headless serve)
    const args: string[] = [cwd, "--port", String(port), "--hostname", hostname]
    if (opts.sessionID) args.push("-s", opts.sessionID)
    if (opts.model) args.push("-m", opts.model)
    if (opts.agent) args.push("--agent", opts.agent)
    if (opts.prompt) args.push("--prompt", opts.prompt)
    if (opts.continue) args.push("--continue")
    if (opts.fork) args.push("--fork")
    const url = `http://${hostname}:${port}`

    return { port, hostname, bin, cwd, devMode, args, url }
  }

  export async function resolveEmbeddedCommand(opts: SpawnOptions = {}): Promise<EmbeddedCommand> {
    const resolved = await resolveSpawn(opts)
    if (resolved.devMode) {
      const pkgRoot = packageRoot()
      const entryScript = path.join(pkgRoot, "src", "index.ts")
      return {
        command: "bun",
        args: ["--preload", "@opentui/solid/preload", "--conditions=browser", entryScript, ...resolved.args],
        cwd: pkgRoot,
        url: resolved.url,
        port: resolved.port,
        hostname: resolved.hostname,
      }
    }
    return {
      command: resolved.bin,
      args: resolved.args,
      cwd: resolved.cwd,
      url: resolved.url,
      port: resolved.port,
      hostname: resolved.hostname,
    }
  }

  export async function spawn(opts: SpawnOptions = {}): Promise<Handle> {
    const resolved = await resolveSpawn(opts)
    const { port, hostname, bin, cwd, devMode, args, url } = resolved

    let proc: ChildProcess
    if (process.platform === "win32") {
      // Windows: launch TUI in a new visible console window via a .bat file.
      // PowerShell Start-Process is unreliable when called from a compiled Bun binary,
      // so we use `cmd /c start ... cmd /k <bat>` which works consistently.
      const batFile = path.join(os.tmpdir(), `opencorvus-tui-${port}.bat`)
      const quotedArgs = args.map((a) => `"${a}"`).join(" ")
      if (devMode) {
        const pkgRoot = packageRoot()
        const entryScript = path.join(pkgRoot, "src", "index.ts")
        fs.writeFileSync(
          batFile,
          [
            `@title OpenCorvus TUI`,
            `@cd /d "${pkgRoot}"`,
            `@bun --preload @opentui/solid/preload --conditions=browser "${entryScript}" ${quotedArgs}`,
          ].join("\r\n"),
        )
      } else {
        fs.writeFileSync(batFile, [`@title OpenCorvus TUI`, `@"${bin}" ${quotedArgs}`].join("\r\n"))
      }
      proc = nodeSpawn("cmd.exe", ["/c", "start", "OpenCorvus TUI", "cmd.exe", "/k", batFile], {
        stdio: "ignore",
        detached: true,
        windowsHide: false,
      })
      proc.unref()
    } else if (process.platform === "darwin") {
      // macOS: launch TUI in a new Terminal.app window via a shell script.
      const shFile = path.join(os.tmpdir(), `opencorvus-tui-${port}.sh`)
      const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")
      if (devMode) {
        const pkgRoot = packageRoot()
        const entryScript = path.join(pkgRoot, "src", "index.ts")
        fs.writeFileSync(
          shFile,
          [
            `#!/bin/bash`,
            `cd '${pkgRoot.replace(/'/g, "'\\''")}'`,
            `exec bun --preload @opentui/solid/preload --conditions=browser '${entryScript.replace(/'/g, "'\\''")}' ${escapedArgs}`,
          ].join("\n"),
        )
      } else {
        fs.writeFileSync(shFile, [`#!/bin/bash`, `exec '${bin.replace(/'/g, "'\\''")}' ${escapedArgs}`].join("\n"))
      }
      fs.chmodSync(shFile, 0o755)
      // Use `open -a Terminal.app <script>` to open in a new visible terminal window
      proc = nodeSpawn("open", ["-a", "Terminal.app", shFile], {
        stdio: "ignore",
        detached: true,
      })
      proc.unref()
    } else {
      // Linux: launch TUI in a new terminal emulator window.
      // Try common terminal emulators in order of popularity.
      const shFile = path.join(os.tmpdir(), `opencorvus-tui-${port}.sh`)
      const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")
      if (devMode) {
        const pkgRoot = packageRoot()
        const entryScript = path.join(pkgRoot, "src", "index.ts")
        fs.writeFileSync(
          shFile,
          [
            `#!/bin/bash`,
            `cd '${pkgRoot.replace(/'/g, "'\\''")}'`,
            `exec bun --preload @opentui/solid/preload --conditions=browser '${entryScript.replace(/'/g, "'\\''")}' ${escapedArgs}`,
          ].join("\n"),
        )
      } else {
        fs.writeFileSync(shFile, [`#!/bin/bash`, `exec '${bin.replace(/'/g, "'\\''")}' ${escapedArgs}`].join("\n"))
      }
      fs.chmodSync(shFile, 0o755)

      const terminal = findLinuxTerminal()
      if (terminal) {
        // Launch in a new terminal window
        const termArgs = linuxTerminalArgs(terminal, "OpenCorvus TUI", shFile)
        proc = nodeSpawn(terminal, termArgs, {
          stdio: "ignore",
          detached: true,
          cwd,
        })
        proc.unref()
      } else {
        // Fallback: run in background with own PTY (no visible window)
        proc = nodeSpawn(shFile, [], {
          stdio: "ignore",
          detached: true,
          cwd,
        })
        proc.unref()
      }
    }

    await waitForServer(url)
    return new Handle(url, proc)
  }

  /**
   * Connect to an already-running TUI server and return a Handle for controlling it.
   */
  export function connect(url: string, _opts: ConnectOptions = {}): Handle {
    return new Handle(url)
  }
}
